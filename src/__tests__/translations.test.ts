/**
 * @vitest-environment jsdom
 */
/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import en from './../messages/ui.en.json';
// TODO: actually import the right one!
const da = en;

// We're moving translations to Crowdin so expect the English to be the only
// updated language for now
describe.skip('Translation tests', () => {
  test('Should be same number of translations', () => {
    const danishTranslationCount = Object.keys(da).length;
    const englishTranslationCount = Object.keys(en).length;
    expect(danishTranslationCount).toEqual(englishTranslationCount);
  });

  test('Translations are the same', () => {
    const danishTranslationKeys = Object.getOwnPropertyNames(da) as (keyof typeof da)[];
    for (let i = 0; i < danishTranslationKeys.length; i++) {
      const danishKey = danishTranslationKeys[i];
      // @ts-ignore - as translations are intentionally allowed to differ
      expect(en[danishKey], 'Something not the same -> ' + danishKey).toBeDefined();
    }
  });

  // Mostly an architecture test
  test('Translations should be in the same order', () => {
    const danishTranslationKeys = Object.getOwnPropertyNames(da);
    const englishTranslationKeys = Object.getOwnPropertyNames(en);
    for (let i = 0; i < englishTranslationKeys.length; i++) {
      const danishKey = danishTranslationKeys[i];
      const englishKey = englishTranslationKeys[i];
      expect(danishKey, `Not the same order found for -> ${danishKey}`).toEqual(
        englishKey,
      );
    }
  });
});

export {};
