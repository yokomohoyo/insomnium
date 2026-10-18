// Insomnium's documentation is the Markdown in docs/, as GitHub shows it.
// (Insomnia's docs now describe a later Insomnia, with features and
// accounts Insomnium doesn't have.)
const insomniumDocs = (page: string) => `https://github.com/yokomohoyo/insomnium/blob/main/docs/${page}`;

export const docsBase = insomniumDocs('README.md');
export const docsGitSync = insomniumDocs('git-sync.md');
export const docsTemplateTags = insomniumDocs('template-tags.md');
export const docsVersionControl = insomniumDocs('git-sync.md');
export const docsPlugins = insomniumDocs('plugins.md');
export const docsImportExport = insomniumDocs('import-export.md');
export const docsKeyMaps = insomniumDocs('keyboard-shortcuts.md');
export const docsIntroductionInsomnia = insomniumDocs('getting-started.md');
export const docsWorkingWithDesignDocs = insomniumDocs('design-documents.md');
export const docsUnitTesting = insomniumDocs('testing.md#unit-tests-in-design-documents');
export const docsRunInCI = insomniumDocs('testing.md#run-a-collection-in-ci');
export const docsScripts = insomniumDocs('scripts.md');

export const docsGitAccessToken = {
  github: 'https://docs.github.com/github/authenticating-to-github/creating-a-personal-access-token',
  gitlab: 'https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html',
  bitbucket: 'https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/',
  bitbucketServer: 'https://confluence.atlassian.com/bitbucketserver/personal-access-tokens-939515499.html',
  azureDevOps: 'https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate',
};

export const documentationLinks = {
  introductionToInsomnia: {
    title: 'Introduction to Insomnium',
    url: docsIntroductionInsomnia,
  },
  workingWithDesignDocs: {
    title: 'Working with Design Documents',
    url: docsWorkingWithDesignDocs,
  },
  unitTesting: {
    title: 'Unit Testing',
    url: docsUnitTesting,
  },
  runInCI: {
    title: 'Run Collections in CI',
    url: docsRunInCI,
  },
} as const;
