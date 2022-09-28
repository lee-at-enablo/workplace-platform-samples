const { v4: uuidv4 } = require('uuid');
const Survey = require('../survey');

class SurveyTrackingService {
  surveysTracked = [];

  getVersion() {
    return 'the latest version';
  }

  startTrackingNewUserSurvey(userId) {
    const parsedUserId = this.trimAndValidateUserId(userId);

    const dateTime = Date.now();
    const survey = new Survey(
      uuidv4(),
      parsedUserId,
      dateTime,
      undefined,
      undefined
    );
    if (!this.surveysTracked) {
      this.surveysTracked = [];
      this.surveysTracked.push(survey);
    } else {
      this.surveysTracked.push(survey);
    }
  }

  trimAndValidateUserId(userId) {
    return userId.trim();
  }

  getCurrentlyTrackedSurveyByUserOrStartTrackingIfNoneFound(userId) {
    let trackedSurvey = this.getCurrentlyTrackedSurveyByUser(userId);
    if (!trackedSurvey) {
      this.startTrackingNewUserSurvey(userId);
      trackedSurvey = this.getCurrentlyTrackedSurveyByUser(userId);
    }
    if (!trackedSurvey) {
      throw Error(`Can't find or track survey for user ${userId}`);
    }
    return trackedSurvey;
  }

  getCurrentlyTrackedSurveyByUser(userId) {
    return this.surveysTracked.find((survey) => survey.userId === userId);
  }

  stopTrackingUserSurvey(survey) {
    this.surveysTracked = this.surveysTracked.filter(
      (trackedSurvey) => survey.id !== trackedSurvey.id
    );
    console.log(`Stopped tracking survey. ${survey.outputSurvey()}`);
  }

  trackSentMessage(messageData) {
    const userId = this.trimAndValidateUserId(messageData.recipient.id);
    const messageText = messageData.message.text;
    const trackedSurvey =
      this.getCurrentlyTrackedSurveyByUserOrStartTrackingIfNoneFound(userId);
    trackedSurvey.trackSentMessage(messageText, messageData.alias);
    trackedSurvey.outputSurvey();
  }

  trackReceivedMessage(event) {
    const userId = this.trimAndValidateUserId(event.sender.id);
    const { timestamp } = event;
    const { id, text } = event.message;

    const trackedSurvey =
      this.getCurrentlyTrackedSurveyByUserOrStartTrackingIfNoneFound(userId);
    trackedSurvey.trackReceivedMessage(id, timestamp, text);
    trackedSurvey.outputSurvey();
  }
}
module.exports = SurveyTrackingService;
