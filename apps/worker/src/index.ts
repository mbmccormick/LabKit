import type { DictionaryFile } from '@labkit/core';
import dictionary from '../../../dictionary/dictionary.json';
import { createApp } from './app';
import { KEYSETS } from './keys.gen';

export default createApp({ dictionary: dictionary as DictionaryFile, keysets: KEYSETS });
