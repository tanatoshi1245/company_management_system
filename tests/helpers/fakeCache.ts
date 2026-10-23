/** Workers の Cache API（caches.default）の代わり。テストで HIT / MISS を確かめるために Map に Response を保存する */
export function installFakeCache(): Map<string, Response> {
  const store = new Map<string, Response>();
  const fake = {
    async match(req: Request | string): Promise<Response | undefined> {
      const url = typeof req === 'string' ? req : req.url;
      const hit = store.get(url);
      return hit ? hit.clone() : undefined;
    },
    async put(req: Request | string, res: Response): Promise<void> {
      const url = typeof req === 'string' ? req : req.url;
      store.set(url, res.clone());
    },
    async delete(req: Request | string): Promise<boolean> {
      const url = typeof req === 'string' ? req : req.url;
      return store.delete(url);
    },
  };
  (globalThis as unknown as { caches: unknown }).caches = { default: fake };
  return store;
}

export function uninstallFakeCache(): void {
  delete (globalThis as unknown as { caches?: unknown }).caches;
}
