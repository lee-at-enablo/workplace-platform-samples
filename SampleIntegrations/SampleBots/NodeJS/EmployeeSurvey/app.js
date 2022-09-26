/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */

('use strict');

const FINAL_SURVEY_STAGE = 'thankyou';

const bodyParser = require('body-parser');
const crypto = require('crypto');
const express = require('express');
const request = require('request');
const { v4: uuidv4 } = require('uuid');
const Survey = require('./survey');
const MessageType = require('./messageType');
require('dotenv').config();

let surveysTracked = [];
const app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

/*
 * Be sure to setup your config values before running this code. You can
 * set them using environment variables.
 *
 * https://developers.facebook.com/docs/workplace/integrations/custom-integrations/apps
 *
 */
const { APP_SECRET } = process.env;
const { VERIFY_TOKEN } = process.env;
const { ACCESS_TOKEN } = process.env;
const { SERVER_URL } = process.env;

if (!(APP_SECRET && VERIFY_TOKEN && ACCESS_TOKEN && SERVER_URL)) {
  console.error('Missing environment variables');
  process.exit(1);
}

const GRAPH_API_BASE = 'https://graph.facebook.com/v2.6';

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * your custom integration, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/workplace/integrations/custom-integrations/apps
 *
 */
function verifyRequestSignature(req, res, buf) {
  const signature = req.headers['x-hub-signature'];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    const elements = signature.split('=');
    const signatureHash = elements[1];

    const expectedHash = crypto
      .createHmac('sha1', APP_SECRET)
      .update(buf)
      .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

function startTrackingNewUserSurvey(userId) {
  const parsedUserId = trimAndValidateUserId(userId);

  const currentlyTrackedSurvey = getCurrentlyTrackedSurveyByUser(parsedUserId);
  if (currentlyTrackedSurvey) {
    console.log(
      `I am already tracking an unfinished survey for this user ${parsedUserId}. I will discard it but perhaps later send off the contents`
    );
    finishSurveyAndStopTracking(currentlyTrackedSurvey);
  }

  const id = uuidv4();
  const dateTime = Date.now();
  const survey = new Survey(id, parsedUserId, dateTime, undefined, undefined);
  if (!surveysTracked) {
    console.log('tracking first survey');
    surveysTracked = [];
    surveysTracked.push(survey);
  } else {
    surveysTracked.push(survey);
  }

  console.log(`Started tracking survey for user ${parsedUserId}.`);
}

function trimAndValidateUserId(userId) {
  return userId.trim();
}

function getCurrentlyTrackedSurveyByUserOrStartTrackingIfNoneFound(userId) {
  let trackedSurvey = getCurrentlyTrackedSurveyByUser(userId);
  if (!trackedSurvey) {
    startTrackingNewUserSurvey(userId);
    trackedSurvey = getCurrentlyTrackedSurveyByUser(userId);
  }
  if (!trackedSurvey) {
    throw Error(`Can't find or track survey for user ${userId}`);
  }
  return trackedSurvey;
}

function getCurrentlyTrackedSurveyByUser(userId) {
  const matchingSurvey = surveysTracked.find((survey) => {
    const result = survey.userId === userId;
    console.log(
      `comparing ${survey.userId} with ${userId} result is ${result}`
    );
    return result;
  });
  if (!matchingSurvey) {
    console.log(
      `couldn't find matchingSurvey for ${userId}. I am tracking ${
        surveysTracked && surveysTracked.length ? surveysTracked.length : '0'
      } surveys.`
    );
  }
  return matchingSurvey;
}

function finishSurveyAndStopTracking(survey) {
  survey.finish();
  stopTrackingUserSurvey(survey);
}

function stopTrackingUserSurvey(survey) {
  surveysTracked = surveysTracked.filter(
    (trackedSurvey) => survey.id !== trackedSurvey.id
  );
  console.log(`Stopped tracking survey. ${survey.outputSurvey()}`);
}

app.get('/start/:user', (req, res) => {
  const userId = req.params.user;
  startSurvey(userId);
  res.sendStatus(200);
});

function startSurvey(userId) {
  console.log('Start', userId);
  startTrackingNewUserSurvey(userId);
  sendStartSurvey(userId);
}

/*
 * Use your own validation token. This can be any string. Check that the
 * token used in the Webhook setup is the same token used here.
 *
 */
app.get('/webhook', (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === VERIFY_TOKEN
  ) {
    console.log('Validating webhook');
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error('Failed validation. Make sure the validation tokens match.');
    res.sendStatus(403);
  }
});

/*
 * All callbacks for webhooks are POST-ed. They will be sent to the same
 * webhook URL. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 *
 * https://developers.facebook.com/docs/workplace/integrations/custom-integrations/apps
 */
app.post('/webhook', (req, res) => {
  const data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach((pageEntry) => {
      // Iterate over each messaging event
      pageEntry.messaging.forEach((messagingEvent) => {
        if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

function conditionsMetForHiMessageToTriggerNewSurvey(userId) {
  // if we have no state of a survey, or they have a survey that's finished (last question sent has final stage alias)
  // let them start again.. otherwise completetly ignore this and exit the function
  const currentSurvey = getCurrentlyTrackedSurveyByUser(userId);
  if (!currentSurvey) return true;

  const mostRecentSentMessage = currentSurvey.getMostRecentMessage(
    MessageType.Outgoing
  );
  if (
    mostRecentSentMessage &&
    mostRecentSentMessage.alias === FINAL_SURVEY_STAGE
  )
    return true;

  return false;
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 */
function receivedMessage(event) {
  const senderID = event.sender.id;
  if (event.message.text && event.message.text === 'hi') {
    if (conditionsMetForHiMessageToTriggerNewSurvey(senderID)) {
      startSurvey(senderID);
    } else {
      // just ignore that they've said hi, don't process the message further
      return;
    }
  }
  trackReceivedMessage(event);
  finishSurveyIfExitConditionsMet(event.sender.id);

  const recipientID = event.recipient.id;
  const timeOfMessage = event.timestamp;
  const { message } = event;

  console.log(
    'Received message for user %d and page %d at %d with message:',
    senderID,
    recipientID,
    timeOfMessage
  );
  console.log(JSON.stringify(message));

  const isEcho = message.is_echo;
  const messageId = message.mid;
  const appId = message.app_id;
  const { metadata } = message;

  // You may get a text or attachment but not both
  const quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log(
      'Received echo for message %s and app %d with metadata %s',
      messageId,
      appId,
      metadata
    );
  } else if (quickReply) {
    const quickReplyPayload = quickReply.payload;
    console.log(
      'Quick reply for message %s with payload %s',
      messageId,
      quickReplyPayload
    );

    const payload_tokens = quickReplyPayload.split(':');
    const payload_action = payload_tokens[0];

    // We're using predefined metadata payloads for the quickreply messages
    // so let's use these to understand what should happen next
    switch (payload_action) {
      case 'DELAY_SURVEY':
        sendDelaySurvey(senderID);
        break;
      case 'START_SURVEY':
        sendFirstQuestion(senderID);
        break;
      case 'HAPPY':
        sendSecondQuestion(senderID);
        break;
      case 'STAY':
        sendThankYou(senderID);
        break;
      default:
        console.log('Quick reply tapped', senderID, quickReplyPayload);
        break;
    }
  }
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendStartSurvey(recipientId) {
  request(
    {
      baseUrl: GRAPH_API_BASE,
      url: `/${recipientId}`,
      qs: {
        fields: 'first_name',
      },
      auth: { bearer: ACCESS_TOKEN },
    },
    (error, response, body) => {
      body = JSON.parse(body);
      const messageData = {
        recipient: {
          id: body.id,
        },
        message: {
          text: `Hi ${body.first_name}, your opinion matters to us. Do you have a few seconds to answer a quick survey?`,
          quick_replies: [
            {
              content_type: 'text',
              title: 'Yes',
              payload: 'START_SURVEY',
            },
            {
              content_type: 'text',
              title: 'Not now',
              payload: 'DELAY_SURVEY',
            },
          ],
        },
      };

      callSendAPI(messageData);
    }
  );
}

/*
 * Send a text message using the Send API.
 *
 */
function sendDelaySurvey(recipientId) {
  const messageData = {
    recipient: {
      id: recipientId,
    },
    message: {
      text: "No problem, we'll try again tomorrow",
    },
  };

  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendThankYou(recipientId) {
  const messageData = {
    alias: FINAL_SURVEY_STAGE,
    recipient: {
      id: recipientId,
    },
    message: {
      text: 'Thanks for your feedback! If you have any other comments, write them below.',
    },
  };

  callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendFirstQuestion(recipientId) {
  const messageData = {
    alias: 'happiness',
    recipient: {
      id: recipientId,
    },
    message: {
      text: "Between 1 and 5, where 5 is 'Very Happy', how happy are you working here?",
      quick_replies: [
        {
          content_type: 'text',
          title: '☹️ 1',
          payload: 'HAPPY:1',
        },
        {
          content_type: 'text',
          title: '2',
          payload: 'HAPPY:2',
        },
        {
          content_type: 'text',
          title: '3',
          payload: 'HAPPY:3',
        },
        {
          content_type: 'text',
          title: '4',
          payload: 'HAPPY:4',
        },
        {
          content_type: 'text',
          title: '5 😃',
          payload: 'HAPPY:5',
        },
      ],
    },
  };

  callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendSecondQuestion(recipientId) {
  const messageData = {
    alias: 'longevity',
    recipient: {
      id: recipientId,
    },
    message: {
      text: 'How long do you plan to stay in the company?',
      quick_replies: [
        {
          content_type: 'text',
          title: '0-1 years',
          payload: 'STAY:1',
        },
        {
          content_type: 'text',
          title: '1-2 years',
          payload: 'STAY:2',
        },
        {
          content_type: 'text',
          title: '2-4 years',
          payload: 'STAY:3',
        },
        {
          content_type: 'text',
          title: '5+ years',
          payload: 'STAY:4',
        },
      ],
    },
  };

  callSendAPI(messageData);
}

function trackSentMessage(messageData) {
  const userId = trimAndValidateUserId(messageData.recipient.id);
  const messageText = messageData.message.text;
  const trackedSurvey =
    getCurrentlyTrackedSurveyByUserOrStartTrackingIfNoneFound(userId);
  trackedSurvey.trackSentMessage(messageText, messageData.alias);
  trackedSurvey.outputSurvey();
}

function trackReceivedMessage(event) {
  const userId = trimAndValidateUserId(event.sender.id);
  const { timestamp } = event;
  const { id, text } = event.message;

  const trackedSurvey =
    getCurrentlyTrackedSurveyByUserOrStartTrackingIfNoneFound(userId);
  trackedSurvey.trackReceivedMessage(id, timestamp, text);
  trackedSurvey.outputSurvey();
}

function finishSurveyIfExitConditionsMet(userId) {
  const parsedUserId = trimAndValidateUserId(userId);
  const trackedSurvey =
    getCurrentlyTrackedSurveyByUserOrStartTrackingIfNoneFound(parsedUserId);
  const mostRecentReceivedMessage = trackedSurvey.getMostRecentMessage(
    MessageType.Incoming
  );
  if (
    mostRecentReceivedMessage &&
    mostRecentReceivedMessage.alias === FINAL_SURVEY_STAGE
  ) {
    finishSurveyAndStopTracking(trackedSurvey);
  }
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
  request(
    {
      baseUrl: GRAPH_API_BASE,
      url: '/me/messages',
      qs: { access_token: ACCESS_TOKEN },
      method: 'POST',
      json: messageData,
    },
    (error, response, body) => {
      if (!error && response.statusCode == 200) {
        const recipientId = body.recipient_id;
        const messageId = body.message_id;

        if (messageId) {
          console.log(
            'Successfully sent message with id %s to recipient %s',
            messageId,
            recipientId
          );
          trackSentMessage(messageData);
        } else {
          console.log(
            'Successfully called Send API for recipient %s',
            recipientId
          );
        }
      } else {
        console.error(
          'Failed calling Send API',
          response.statusCode,
          response.statusMessage,
          body.error
        );
      }
    }
  );
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), () => {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;
