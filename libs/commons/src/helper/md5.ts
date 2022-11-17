import { createHash } from 'crypto';

const hashMd5 = createHash('md5');
export function md5(text: string) {
  return hashMd5.copy().update(text).digest('hex');
}
