import { lookup, mimes } from 'mrmime';

const mimeToExtension = new Map<string, string>();
for (const [ext, mime] of Object.entries(mimes)) {
  if (!mimeToExtension.has(mime as string))
    mimeToExtension.set(mime as string, ext);
}

const mimeAdapter = {
  getType: (pathOrExtension: string): string | null => {
    return lookup(pathOrExtension) || null;
  },
  getExtension: (mimeType: string): string | null => {
    const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
    return mimeToExtension.get(cleanMime) || null;
  }
};

export default mimeAdapter;
