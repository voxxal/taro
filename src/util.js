const FILE_NAME = "hardcoded.taro"
export class TaroError extends Error {
  constructor(message = "", line, ...args) {
super(message, ...args);
    this.message = `${message} (${FILE_NAME}:${line})`;
  }
}


