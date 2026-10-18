import type { Faker } from '@faker-js/faker';

// Postman's dynamic variables ({{$randomFullName}}), by the names Kong
// Insomnia's faker tag also takes ({% faker 'randomFullName' %}), so either
// tool's collections render here. Each returns what Postman documents for it.
// a picture in the category, from loremflickr.com, as faker's urlLoremFlickr
// gave (deprecated in faker 10, which has no categories otherwise)
const categoryImage = (category: string) => (faker: Faker) =>
  `https://loremflickr.com/640/480/${category}?lock=${faker.number.int({ min: 1, max: 1_000_000 })}`;

export const fakerFunctions: Record<string, (faker: Faker) => string> = {
  guid: faker => faker.string.uuid(),
  timestamp: () => String(Math.floor(Date.now() / 1000)),
  isoTimestamp: () => new Date().toISOString(),
  randomUUID: faker => faker.string.uuid(),

  randomAlphaNumeric: faker => faker.string.alphanumeric(1),
  randomBoolean: faker => String(faker.datatype.boolean()),
  randomInt: faker => String(faker.number.int({ min: 0, max: 1000 })),
  randomColor: faker => faker.color.human(),
  randomHexColor: faker => faker.color.rgb(),
  randomAbbreviation: faker => faker.hacker.abbreviation(),

  randomIP: faker => faker.internet.ipv4(),
  randomIPV6: faker => faker.internet.ipv6(),
  randomMACAddress: faker => faker.internet.mac(),
  randomPassword: faker => faker.string.alphanumeric(15),
  randomLocale: faker => faker.location.language().alpha2,
  randomUserAgent: faker => faker.internet.userAgent(),
  randomProtocol: faker => faker.internet.protocol(),
  randomSemver: faker => faker.system.semver(),

  randomFirstName: faker => faker.person.firstName(),
  randomLastName: faker => faker.person.lastName(),
  randomFullName: faker => faker.person.fullName(),
  randomNamePrefix: faker => faker.person.prefix(),
  randomNameSuffix: faker => faker.person.suffix(),

  randomJobArea: faker => faker.person.jobArea(),
  randomJobDescriptor: faker => faker.person.jobDescriptor(),
  randomJobTitle: faker => faker.person.jobTitle(),
  randomJobType: faker => faker.person.jobType(),

  randomPhoneNumber: faker => faker.helpers.replaceSymbols('###-###-####'),
  randomPhoneNumberExt: faker => faker.helpers.replaceSymbols('##-###-###-####'),
  randomCity: faker => faker.location.city(),
  randomStreetName: faker => faker.location.street(),
  randomStreetAddress: faker => faker.location.streetAddress(),
  randomCountry: faker => faker.location.country(),
  randomCountryCode: faker => faker.location.countryCode('alpha-2'),
  randomLatitude: faker => String(faker.location.latitude()),
  randomLongitude: faker => String(faker.location.longitude()),

  randomAvatarImage: faker => faker.image.avatar(),
  randomImageUrl: faker => faker.image.url(),
  randomAbstractImage: categoryImage('abstract'),
  randomAnimalsImage: categoryImage('animals'),
  randomBusinessImage: categoryImage('business'),
  randomCatsImage: categoryImage('cats'),
  randomCityImage: categoryImage('city'),
  randomFoodImage: categoryImage('food'),
  randomNightlifeImage: categoryImage('nightlife'),
  randomFashionImage: categoryImage('fashion'),
  randomPeopleImage: categoryImage('people'),
  randomNatureImage: categoryImage('nature'),
  randomSportsImage: categoryImage('sports'),
  randomTransportImage: categoryImage('transport'),
  randomImageDataUri: faker => faker.image.dataUri(),

  randomBankAccount: faker => faker.finance.accountNumber(8),
  randomBankAccountName: faker => faker.finance.accountName(),
  randomCreditCardMask: faker => faker.string.numeric(4),
  randomBankAccountBic: faker => faker.finance.bic(),
  randomBankAccountIban: faker => faker.finance.iban(),
  randomTransactionType: faker => faker.finance.transactionType(),
  randomCurrencyCode: faker => faker.finance.currencyCode(),
  randomCurrencyName: faker => faker.finance.currencyName(),
  randomCurrencySymbol: faker => faker.finance.currencySymbol(),
  randomBitcoin: faker => faker.finance.bitcoinAddress(),

  randomCompanyName: faker => faker.company.name(),
  randomCompanySuffix: faker => faker.helpers.arrayElement(['Inc', 'LLC', 'Group', 'and Sons']),
  randomBs: faker => faker.company.buzzPhrase(),
  randomBsAdjective: faker => faker.company.buzzAdjective(),
  randomBsBuzz: faker => faker.company.buzzVerb(),
  randomBsNoun: faker => faker.company.buzzNoun(),

  randomCatchPhrase: faker => faker.company.catchPhrase(),
  randomCatchPhraseAdjective: faker => faker.company.catchPhraseAdjective(),
  randomCatchPhraseDescriptor: faker => faker.company.catchPhraseDescriptor(),
  randomCatchPhraseNoun: faker => faker.company.catchPhraseNoun(),

  randomDatabaseColumn: faker => faker.database.column(),
  randomDatabaseType: faker => faker.database.type(),
  randomDatabaseCollation: faker => faker.database.collation(),
  randomDatabaseEngine: faker => faker.database.engine(),

  randomDateFuture: faker => faker.date.future().toString(),
  randomDatePast: faker => faker.date.past().toString(),
  randomDateRecent: faker => faker.date.recent().toString(),
  randomWeekday: faker => faker.date.weekday(),
  randomMonth: faker => faker.date.month(),

  randomDomainName: faker => faker.internet.domainName(),
  randomDomainSuffix: faker => faker.internet.domainSuffix(),
  randomDomainWord: faker => faker.internet.domainWord(),
  randomEmail: faker => faker.internet.email(),
  randomExampleEmail: faker => faker.internet.exampleEmail(),
  randomUserName: faker => faker.internet.username(),
  randomUrl: faker => faker.internet.url(),

  randomFileName: faker => faker.system.fileName(),
  randomFileType: faker => faker.system.fileType(),
  randomFileExt: faker => faker.system.fileExt(),
  randomCommonFileName: faker => faker.system.commonFileName(),
  randomCommonFileType: faker => faker.system.commonFileType(),
  randomCommonFileExt: faker => faker.system.commonFileExt(),
  randomFilePath: faker => faker.system.filePath(),
  randomDirectoryPath: faker => faker.system.directoryPath(),
  randomMimeType: faker => faker.system.mimeType(),

  randomPrice: faker => faker.commerce.price({ min: 100, max: 1000 }),
  randomProduct: faker => faker.commerce.product(),
  randomProductAdjective: faker => faker.commerce.productAdjective(),
  randomProductMaterial: faker => faker.commerce.productMaterial(),
  randomProductName: faker => faker.commerce.productName(),
  randomDepartment: faker => faker.commerce.department(),

  randomNoun: faker => faker.hacker.noun(),
  randomVerb: faker => faker.hacker.verb(),
  randomIngverb: faker => faker.hacker.ingverb(),
  randomAdjective: faker => faker.hacker.adjective(),
  randomWord: faker => faker.word.sample(),
  randomWords: faker => faker.word.words(),
  randomPhrase: faker => faker.hacker.phrase(),

  randomLoremWord: faker => faker.lorem.word(),
  randomLoremWords: faker => faker.lorem.words(),
  randomLoremSentence: faker => faker.lorem.sentence(),
  randomLoremSentences: faker => faker.lorem.sentences(),
  randomLoremParagraph: faker => faker.lorem.paragraph(),
  randomLoremParagraphs: faker => faker.lorem.paragraphs(),
  randomLoremText: faker => faker.lorem.text(),
  randomLoremSlug: faker => faker.lorem.slug(),
  randomLoremLines: faker => faker.lorem.lines(),
};

export const isFakerFunction = (name: string) => Object.prototype.hasOwnProperty.call(fakerFunctions, name);

// {{$randomFullName}} as Postman writes it, the name captured
const DYNAMIC_VARIABLE = /{{\s*\$(\w+)\s*}}/g;

// Postman's dynamic variables in an imported value become faker tags, all the
// way down; a name we don't know stays as it was. Descriptions are left alone:
// they aren't rendered, and hold the Postman scripts, kept as written.
// descriptions and scripts are kept as written: a script's {{ }} is code
const KEPT_AS_WRITTEN = ['description', 'preRequestScript', 'afterResponseScript'];

export const translateDynamicVariables = <T>(value: T): T => {
  if (typeof value === 'string') {
    return value.replace(DYNAMIC_VARIABLE, (match, name) => isFakerFunction(name) ? `{% faker '${name}' %}` : match) as T;
  }
  if (Array.isArray(value)) {
    return value.map(translateDynamicVariables) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, KEPT_AS_WRITTEN.includes(key) ? item : translateDynamicVariables(item)])) as T;
  }
  return value;
};
