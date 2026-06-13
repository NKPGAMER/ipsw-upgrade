import userData from "./userData";

class _MetaData {
  private readonly file = "metadata.json"
  private parse(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  async read(): Promise<Record<string, unknown>>;
  async read<T = unknown>(key: string): Promise<T | null>;
  async read<T = unknown>(key?: string): Promise<Record<string, unknown> | T | null> {
    const raw = await userData.read<string>(this.file);
    const data = this.parse(raw);
    if (key === undefined) return data;
    return (data[key] as T) ?? null;
  }

  async write(data: Record<string, unknown>): Promise<boolean> {
    try {
      await userData.write(this.file, data);
      return true;
    } catch (error) {
      console.error("[metadata] Failed to write:", error);
      return false;
    }
  }

  async update(patch: Record<string, unknown>): Promise<boolean> {
    const current = await this.read();
    return this.write({ ...current, ...patch });
  }
};

export default new _MetaData();