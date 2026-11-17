import type http from 'node:http';
export function createMockServer(): {
  server: http.Server;
  listen(port?: number): Promise<http.Server>;
  close(): Promise<void>;
};
