import { faker } from '@faker-js/faker';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { fakerFunctions, isFakerFunction, translateDynamicVariables } from '../faker-functions';
import { render } from '../index';

jest.mock('electron');

describe('fakerFunctions', () => {
  it('gives every Postman dynamic variable a value, with no deprecated faker call', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const [name, generate] of Object.entries(fakerFunctions)) {
        const value = generate(faker);
        expect({ name, type: typeof value }).toEqual({ name, type: 'string' });
        expect({ name, empty: value.length === 0 }).toEqual({ name, empty: false });
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the formats Postman documents', () => {
    const value = (name: string) => fakerFunctions[name](faker);
    expect(value('guid')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Math.abs(Number(value('timestamp')) - Date.now() / 1000)).toBeLessThan(5);
    expect(value('isoTimestamp')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    for (let i = 0; i < 50; i++) {
      expect(Number(value('randomInt'))).toBeGreaterThanOrEqual(0);
      expect(Number(value('randomInt'))).toBeLessThanOrEqual(1000);
    }
    expect(value('randomAlphaNumeric')).toMatch(/^[A-Za-z0-9]$/);
    expect(value('randomPassword')).toMatch(/^[A-Za-z0-9]{15}$/);
    expect(value('randomBoolean')).toMatch(/^(true|false)$/);
    expect(value('randomLocale')).toMatch(/^[a-z]{2}$/);
    expect(value('randomCountryCode')).toMatch(/^[A-Z]{2}$/);
    expect(value('randomHexColor')).toMatch(/^#[0-9a-f]{6}$/);
    expect(value('randomPhoneNumber')).toMatch(/^\d{3}-\d{3}-\d{4}$/);
    expect(value('randomPhoneNumberExt')).toMatch(/^\d{2}-\d{3}-\d{3}-\d{4}$/);
    expect(value('randomBankAccount')).toMatch(/^\d{8}$/);
    expect(value('randomCreditCardMask')).toMatch(/^\d{4}$/);
    expect(Number(value('randomPrice'))).toBeGreaterThanOrEqual(100);
    expect(value('randomCatsImage')).toContain('cats');
  });

  it('knows only its own names', () => {
    expect(isFakerFunction('randomFullName')).toBe(true);
    expect(isFakerFunction('constructor')).toBe(false);
    expect(isFakerFunction('toString')).toBe(false);
  });
});

describe('translateDynamicVariables()', () => {
  it("turns Postman's dynamic variables into faker tags, all the way down", () => {
    expect(translateDynamicVariables([{
      url: 'https://api.example.com/users/{{$randomInt}}?trace={{ $guid }}',
      headers: [{ name: 'X-Name', value: '{{$randomFullName}} <{{$randomEmail}}>' }],
      body: { text: '{"id":"{{$randomUUID}}","at":{{$timestamp}}}' },
      count: 3,
      disabled: false,
      parentId: null,
    }])).toEqual([{
      url: "https://api.example.com/users/{% faker 'randomInt' %}?trace={% faker 'guid' %}",
      headers: [{ name: 'X-Name', value: "{% faker 'randomFullName' %} <{% faker 'randomEmail' %}>" }],
      body: { text: `{"id":"{% faker 'randomUUID' %}","at":{% faker 'timestamp' %}}` },
      count: 3,
      disabled: false,
      parentId: null,
    }]);
  });

  it('leaves variables, unknown names and descriptions as they were', () => {
    const description = "**Postman pre-request script**\n\n```js\npm.variables.replaceIn('{{$guid}}')\n```";
    expect(translateDynamicVariables({
      url: '{{ base }}/{{$notAThing}}/{{$constructor}}',
      description,
    })).toEqual({
      url: '{{ base }}/{{$notAThing}}/{{$constructor}}',
      description,
    });
  });
});

describe('{% faker %}', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  it('renders through the template engine, as a Postman import writes it', async () => {
    expect(await render("{% faker 'randomInt' %}")).toMatch(/^\d+$/);
    expect(await render(translateDynamicVariables('id-{{$guid}}'))).toMatch(/^id-[0-9a-f]{8}-[0-9a-f-]{27}$/);
  });
});
