if (process.env.VCAP_SERVICES){
   var env = JSON.parse(process.env.VCAP_SERVICES);
   var mongo = env['mongodb-1.8'][0]['credentials'];
} else {
   var mongo = {
       "hostname":"localhost",
       "port":27017,
       "username":"",
       "password":"",
       "name":"",
       "db":"db"
   };
}

var generate_mongo_url = function(obj){
   obj.hostname = (obj.hostname || 'localhost');
   obj.port = (obj.port || 27017);
   obj.db = (obj.db || 'test');

   if (obj.username && obj.password) {
      return "mongodb://" + obj.username + ":" + obj.password + "@" + obj.hostname +
             ":" + obj.port + "/" + obj.db;
   } else {
      return "mongodb://" + obj.hostname + ":" + obj.port + "/" + obj.db;
   }
}

var express = require('express');
var app = new express();
var mongourl = generate_mongo_url(mongo);
var mongodb = require('mongodb');
var superagent = require('superagent');
var oauth = require('oauth').OAuth;
var crypto = require('crypto');



require('superagent-oauth')(superagent);

app.configure(function(){
  app.use(express.static(__dirname + '/public'));
  app.use(express.limit('1mb'));
  app.use(express.bodyParser());
});

var record_vist = function(req, res) {
   mongodb.connect(mongourl, function (err, conn){
      conn.collection('ips', function(err, coll){
         var object_to_insert = { 'ip': req.connection.remoteAddress, 'ts': new Date() };
         coll.insert(object_to_insert, {safe: true}, function(err){
            res.send(object_to_insert);
            res.end();
         });
      });
   });
}

app.get('/', record_vist);

var getRandomGrade = function() {
   return Math.floor(Math.random()*100);
};

var getUser = function(bhUserId, username, fullName, callback) {
   var toReturn = {};
   mongodb.connect(mongourl, function(err, conn){
      conn.collection('users', function(err, coll){
         coll.findOne({'username':username}, function(err, result){
            if (err)
            {
               console.log("Error");
            }
            if (result)
            {
               console.log("Found");
               callback(result, false);
            } else {
               console.log("Not Found");
               toInsert = {'bhUserId': bhUserId, 'username': username, 'fullName': fullName};
               coll.insert(toInsert, {safe: true}, function(err){
                  callback(toInsert, true);
               });
            }
         });
      });
   });
};

var insertGrade = function(dbId, grade, callback) {
   mongodb.connect(mongourl, function(err, conn){
      conn.collection('users', function(err, coll){
         coll.update({_id: dbId}, {$addToSet: {grades: grade}}, function(){
            callback(true);
         });
      });
   });
}



var lti_submission = function(req, res) {
   //Get a random grade to assign the user.
   var grade = getRandomGrade();
   console.log(req.body);
   var user_id = req.body.user_id;
   var username = req.body.lis_person_sourcedid;
   var fullName = req.body.lis_person_name_full;
   console.log(req.body.lis_result_sourcedid);
   var resultId = req.body.lis_result_sourcedid;
   var outcomeUrl = req.body.lis_outcome_service_url;
   var consumer
   var theUser = {};

   var returnData = {
      User: false,
      newUser: false,
      Grade: grade
   };

   getUser(user_id, username, fullName, function(user, newUser){
      theUser = user;
      insertGrade(user._id, grade, function(complete){
         returnData.User = user;
         returnData.newUser = newUser;

         replaceResultData =
            '<?xml version = "1.0" encoding = "UTF-8"?>' +
            '<imsx_POXEnvelopeRequest xmlns = "http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0">' +
              '<imsx_POXHeader>'+
                '<imsx_POXRequestHeaderInfo>'+
                  '<imsx_version>V1.0</imsx_version>'+
                  '<imsx_messageIdentifier>'+ Math.floor(Math.random()*1000000) +'</imsx_messageIdentifier>'+
                '</imsx_POXRequestHeaderInfo>'+
              '</imsx_POXHeader>'+
              '<imsx_POXBody>'+
                '<replaceResultRequest>'+
                  '<resultRecord>'+
                    '<sourcedGUID>'+
                      '<sourcedId>'+ resultId +'</sourcedId>'+
                    '</sourcedGUID>'+
                    '<result>'+
                      '<resultScore>'+
                        '<language>en</language>'+
                        '<textString>.'+grade+'</textString>'+
                      '</resultScore>'+
                    '</result>'+
                  '</resultRecord>'+
                '</replaceResultRequest>'+
              '</imsx_POXBody>'+
            '</imsx_POXEnvelopeRequest>';

         console.log(replaceResultData);

         var shasum = crypto.createHash('sha1').update(replaceResultData);

         function s4() {
           return Math.floor((1 + Math.random()) * 0x10000)
           .toString(16)
           .substring(1);
         };

         function guid() {
           return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
           s4() + '-' + s4() + s4() + s4();
         }

         var uuid = guid();

         var authorizationHeader = 'OAuth realm="http%3A%2F%2Flti-test.rs.af.cm",' +
                                   'oauth_body_hash="'+shasum.digest('base64')+'",' +
                                   'oauth_token="Secret0", ' +
                                   'oauth_consumer_key="'+req.body.oauth_consumer_key +'", ' +
                                   'oauth_signature_method="'+req.body.oauth_signature_method+'",' +
                                   'oauth_timestamp="'+ new Date().valueOf() +'", oauth_nonce="'+uuid+'",' +
                                   'oauth_version="'+req.body.oauth_version+'", ' +
                                   'oauth_signature="'+req.body.oauth_signature+'"';

         if (resultId)
         {
            superagent.post(outcomeUrl)//'http://requestb.in/16uan5b1') //
                 .set('Content-Type', 'text/xml')
                 .set('Authorization', authorizationHeader)
                 //.sign(oauth, "Key", "Secret0")
                 .send(replaceResultData)
                 .end(function(response){
                     response.body.testing = resultId;
                     response.body.testing2 = outcomeUrl;
                     res.send(response.body);
                     res.end();
                 });
         }
         else
         {
            res.send(returnData);
            res.end();
         }
      })
   });
   console.log(theUser);
   //Create the user account. (Includes a check if the user exists already).
   //Store the grade in the user's account.

};

app.post('/lti', lti_submission);

app.post('/outcomes', function(req, res){
   res.send(req.body);
   res.end();
});

app.listen(process.env.VCAP_APP_PORT || 3000);
