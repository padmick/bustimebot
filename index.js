'use strict';
const express = require('express')
const bodyParser = require('body-parser')
const request = require('request')
const app = express() //Anytime we need to use express we will access it through app
const token = process.env.FB_VERIFY_TOKEN
const access = process.env.FB_ACCESS_TOKEN

app.set('port', (process.env.PORT || 5000)) //environment variable of PORT for heroku, if trying to run locally 5000

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false})) //Checking for whatever information is coming into the app, if it is json it will handle json information

// Process application/json
app.use(bodyParser.json()) //We are saying we want json from body-parser

// Index route - these are url endpoints
app.get('/', function (req, res) {              
   res.send('The busbot is online!')    // Send a response
})

// for Facebook verification
app.get('/webhook/', function (req, res) {              
    if (req.query['hub.verify_token'] === token) { //verifying correct credentials to access fb
        res.send(req.query['hub.challenge']) //send back a response
    }
    res.send('Error, wrong token')      //If we cant get succesful verification
})

//Listen for POST calls at our webhook, all callbacks will be made to this webhook.
//For receiving messages we look for the messagingEvent.message field and call the receiveMessage function.
app.post('/webhook/', function (req, res) {
  var data = req.body;  

  // Make sure this is a page subscription
  if (data.object === 'page') { 

    // Iterate over each entry - there may be multiple if batched
    data.entry.forEach(function(entry) {
      var pageID = entry.id;           
      var timeOfEvent = entry.time;

      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        if (event.message) {
          receivedMessage(event);      
        } else if (event.postback) {
          receivedPostback(event);       
        }
        else {
          console.log("Webhook received unknown event: ", event);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know
    // you've successfully received the callback. Otherwise, the request
    // will time out and we will keep trying to resend.
    res.sendStatus(200);
  }
});
  
/*
        This is a function which will interpret a message received. The time of message and sender Id is logged in case of an error.
        If the message contains a gif or attachment, a response is sent to the user stating it is not a valid bus stop number.
        Otherwise if the message contains text, the message is logged before parsing the number and after parsing for troubleshooting purposes 
        If the message if not a number send a response to the user requesting a valid bus stop number
        Otherwise if the message is a number, use the sendBusStopInfo() function to check the number with the RTPI
*/
 function receivedMessage(event) {
        var senderID = event.sender.id;
        var recipientID = event.recipient.id;
        var timeOfMessage = event.timestamp;
        var message = event.message;

        console.log("Received message for user %d and page %d at %d with message:", 
        senderID, recipientID, timeOfMessage); 

        var messageId = message.mid;
        var messageText = message.text;
        console.log(typeof messageText !== 'undefined');
        if(typeof messageText !== 'undefined') {                //If the message contains text and not a gif or attachment
                console.log("Before parsing the message is: " + messageText);           //Log what the message is before and after parsing
                messageText = parseInt(messageText.replace ( /[^0-9]/g, ""));           //Takes out everything but the number
                console.log("After parsing the message is: " + messageText);
                if(messageText) {                                                       //If the message is a number send route to dublin bus system                                                    
                        sendBusStopInfo(messageText,senderID);                  //Otherwise we are good to go                       
                } 
                else { 
                        console.log("Non bus stop number received, requested bus stop number.");        //If NaN
                        sendTextMessage(senderID, "Hi welcome to the Irish BusBot. To begin please enter your Bus Stop ID number. This can be found at the stop itself (usually a 6 digit number like  555411) or on http://www.rtpi.ie/ (where this bot gets its data). Bus Eireann, Luas & Dublin bustimes are currently advailable. Please enter a valid bus stop number");            //If we receive just a string with no number this should occur
                }
        }
        else {
                console.log("Non bus stop number received, requested bus stop number.");        //If no text is sent but instead a gif or other attachment
                sendTextMessage(senderID, "Hi welcome to the Irish BusBot. To begin please enter your Bus Stop ID number. This can be found at the stop itself (usually a 6 digit number like  555411) or on http://www.rtpi.ie/ (where this bot gets its data). Bus Eireann, Luas & Dublin bus times are currently advailable. Please enter a valid bus stop number.");
        }                
}


function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback 
  // button for Structured Messages. 
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " + 
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to 
  // let them know it was successful
  sendTextMessage(senderID, "Postback called");
}


function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}

/*
        This function will send the stop number received from the user as a GET request to the Dublin Bus RTPI.
        If unsuccesful response and errors are logged.
        If the RTPI is successfully reached, parse the response as json. If the response has an error code, log the error and send an error message back to the user.
        If there is no error, an array with length equal to the number of buses in the response is created.
        A for loop will send a message back with the next bus of each bus route due to arrive at the user's bus stop.
        This is because in some cases multiple buses of the same route may be due to arrive within a short timeframe and it would spam the user with far too many bus times at once.
*/
function sendBusStopInfo(stopNum,senderID) {
        return request({
                rejectUnauthorized: false,
                uri: 'https://data.dublinked.ie/cgi-bin/rtpi/realtimebusinformation',
                qs: { stopid: stopNum },
                method: 'GET',
                
        }, function(error, response, body) {
                if(!error && response.statusCode === 200) {
                        var jbody = JSON.parse(body);       
                        console.log("Bus Stop request succesful");
                        if(jbody.errorcode != 0) {
                                console.log(jbody.errorcode);
                                console.log(jbody.errormessage);
                                sendTextMessage(senderID,  jbody.errormessage + " (Please note buses cease operation at 00:00 and begin at 05:00)  ");
                        }
                        else {
                                var busRoutes = new Array(jbody.results.length);
                                console.log("Bus stop information retrieved successfully");
                                for(var i = 0; i < jbody.results.length; i++) {
                                        if(busRoutes.indexOf(jbody.results[i].route) === -1) {          //If the bus route does not exist already in the bus array
                                                if(jbody.results[i].duetime > 1) {
                                                        sendTextMessage(senderID, "A " + jbody.results[i].route + " bus will arrive in " + jbody.results[i].duetime + " minutes!");
                                                }
                                                else if(jbody.results[i].duetime === 'Due') {
                                                        sendTextMessage(senderID, "A " + jbody.results[i].route + " bus is arriving now!");
                                                }
                                                else {
                                                        sendTextMessage(senderID, "A " + jbody.results[i].route + " bus will arrive in " + jbody.results[i].duetime + " minute!");
                                                }
                                                busRoutes[i] = jbody.results[i].route;                          //Add the bus route to the bus array so we wont print that route again
                                        }
                                }
                        }                               
                }
                else {
                        console.error("Unable to reach RTPI system");
                        console.error(response);
                        console.error(error);
                }
        });
}
        
    
function callSendAPI(messageData) {
        request({
                uri: 'https://graph.facebook.com/v2.6/me/messages',
                qs: { access_token: access },
                method: 'POST',     //sending it through POST
                json: messageData   //Using json to send our message data through

        }, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                        var recipientId = body.recipient_id;
                        var messageId = body.message_id;

                        console.log("Successfully sent message with id %s to recipient %s", 
                        messageId, recipientId);
                } 
                else {
                        console.error("Unable to send message.");
                        console.error(response);
                        console.error(error);
                }
        });  
}

// Spin up the server
app.listen(app.get('port'), function() {
    console.log('running on port', app.get('port'))
    //setGreetingText();
})

