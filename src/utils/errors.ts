/** A request the owner would not want served. Carries a message worth reading. */
export class Refused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refused";
  }
}
