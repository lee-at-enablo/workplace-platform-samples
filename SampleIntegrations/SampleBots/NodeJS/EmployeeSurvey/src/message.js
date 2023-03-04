class Message {
  constructor(id, text, type, dateTime, alias) {
    this.id = id;
    this.text = text;
    this.type = type;
    this.dateTime = dateTime;
    this.alias = alias;
  }
}
module.exports = Message;
