const { v4: uuidv4 } = require('uuid');
const Message = require('./message');
const MessageType = require('./messageType');

class Survey {
  constructor(id, userId, startDateTime, endDateTime, messages) {
    this.id = id;
    this.userId = userId;
    this.startDateTime = startDateTime;
    this.endDateTime = endDateTime;
    this.messages = messages;
  }

  outputSurvey() {
    console.log(``);
    console.log('***');
    console.log(`User: ${this.userId}`);
    console.log(`Survey started: ${this.startDateTime}`);
    console.log(
      `${
        this.messages && this.messages.length > 0 ? this.messages.length : '0'
      } messages`
    );

    // todo sort messages first
    if (this.messages && this.messages.length > 0) {
      this.messages.forEach((message) => {
        if (message.type === MessageType.Outgoing) {
          console.log(
            `* Question${message.alias ? ` (${message.alias}):` : ':'} ${
              message.text
            } `
          );
        } else {
          console.log(
            `* Answer${message.alias ? ` (${message.alias}):` : ':'} ${
              message.text
            } `
          );
        }
      });
    }
    if (!this.endDateTime) {
      console.log('Survey has not been marked as finished');
    }
    console.log('***');
  }

  finish() {
    this.endDateTime = Date.now();
  }

  trackSentMessage(messageText, messageAlias) {
    const id = uuidv4();
    const type = MessageType.Outgoing;
    const dateTime = Date.now();
    const message = new Message(id, messageText, type, dateTime, messageAlias);
    if (!this.messages) {
      this.messages = [message];
    } else {
      this.messages.push(message);
    }
  }

  getMostRecentMessage(messageType) {
    if (this.messages && this.messages.length > 0) {
      const sortedMessages = this.messages
        .filter((message) => message.type === messageType)
        .sort((a, b) => a.dateTime < b.dateTime);
      if (sortedMessages && sortedMessages.length > 0) {
        return sortedMessages[sortedMessages.length - 1];
      }
    }
  }

  getMessagesByAliasAndType(alias, messageType) {
    if (this.messages && this.messages.length > 0) {
      const sortedMessages = this.messages
        .filter(
          (message) => message.type === messageType && message.alias === alias
        )
        .sort((a, b) => a.dateTime < b.dateTime);
      return sortedMessages;
    }
  }

  trackReceivedMessage(id, dateTime, messageText) {
    const type = MessageType.Incoming;

    // if the most recently sent message had an alias, apply that alias to subsequent replies
    const mostRecentSentMessage = this.getMostRecentMessage(
      MessageType.Outgoing
    );

    const message = new Message(
      id,
      messageText,
      type,
      dateTime,
      mostRecentSentMessage ? mostRecentSentMessage.alias : undefined
    );
    if (!this.messages) {
      this.messages = [message];
    } else {
      this.messages.push(message);
    }
  }
}
module.exports = Survey;
