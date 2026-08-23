export {};

declare global {
  interface Window {
    excalicastDesktop?: {
      invoke(channel: string, payload?: unknown): Promise<unknown>;
      subscribe(channel: string, listener: (payload: unknown) => void): () => void;
    };
  }
}
