import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, open } from 'node:fs/promises';
import * as path from 'node:path';
import { privateBankUnavailable } from '../partner-application/partner-application-private-cipher';
import { DomainError } from '../../common/errors/domain-error';

export const PRIVATE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

@Injectable()
export class PartnerPrivateLocalAdapter {
  constructor(private readonly config: ConfigService) {}

  async writeOnce(storageKey: string, ciphertext: Buffer): Promise<void> {
    const target = this.resolve(storageKey);
    if (!ciphertext.length || ciphertext.length > PRIVATE_IMAGE_MAX_BYTES)
      privateBankUnavailable();
    await mkdir(path.dirname(target), { recursive: true });
    let handle;
    try {
      handle = await open(target, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await this.read(storageKey);
      if (!existing.equals(ciphertext)) privateBankUnavailable();
      return;
    }
    try {
      await handle.writeFile(ciphertext);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async read(storageKey: string): Promise<Buffer> {
    const handle = await open(this.resolve(storageKey), 'r');
    try {
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.size < 1 ||
        info.size > PRIVATE_IMAGE_MAX_BYTES
      )
        privateBankUnavailable();
      const buffer = Buffer.alloc(info.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const result = await handle.read(
          buffer,
          offset,
          buffer.length - offset,
          offset,
        );
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      if (offset !== info.size) privateBankUnavailable();
      return buffer.subarray(0, offset);
    } finally {
      await handle.close();
    }
  }

  async inspect(
    storageKey: string,
    expected: Buffer,
  ): Promise<'ABSENT' | 'MATCH' | 'INCOMPLETE'> {
    this.resolve(storageKey);
    try {
      const bytes = await this.read(storageKey);
      return bytes.equals(expected) ? 'MATCH' : 'INCOMPLETE';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'ABSENT';
      if (error instanceof DomainError && error.statusCode === 503)
        return 'INCOMPLETE';
      throw error;
    }
  }

  private resolve(storageKey: string) {
    if (
      this.config.get<string>('NODE_ENV') !== 'test' ||
      this.config.get<string>('FILE_STORAGE_DRIVER') !== 'local' ||
      !/^partner-application-private\/[a-z0-9-]{1,100}\/[0-9a-f-]{36}\.bin$/.test(
        storageKey,
      )
    )
      privateBankUnavailable();
    const root = this.config.get<string>('FILE_STORAGE_ROOT');
    if (!root) privateBankUnavailable();
    const absoluteRoot = path.resolve(root);
    const target = path.resolve(absoluteRoot, storageKey);
    const relative = path.relative(absoluteRoot, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      privateBankUnavailable();
    return target;
  }
}
