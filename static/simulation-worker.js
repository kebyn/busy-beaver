import { Runner } from "./simulator.js";

const runner = new Runner((snapshot) => self.postMessage(snapshot));
self.onmessage = (event) => runner.handle(event.data);
