import { deepClone } from "../clone.js";
import type { Message } from "../models.js";
import type { MessageStore } from "../protocols.js";

export class InMemoryMessageStore implements MessageStore {
  private messages: Message[];

  constructor(messages: Message[] = []) {
    this.messages = deepClone(messages);
  }

  getMessages(): Message[] {
    return deepClone(this.messages);
  }

  append(message: Message): void {
    this.messages.push(deepClone(message));
  }

  replaceMessages(messages: Message[]): void {
    this.messages = deepClone(messages);
  }

  clear(): void {
    this.messages = [];
  }
}
