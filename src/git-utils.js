const sshParse = require('ssh-parse');
const url = require('url');
const trimStart = require('lodash.trimstart');
const assert = require('assert');

const parseRepoUrl = repoUrl => {
    const parsedRepoUrl = url.parse(repoUrl);
    const parsedRepoSshUrl = sshParse(repoUrl);

    const parsedUrl = parsedRepoUrl.protocol ? parsedRepoUrl : parsedRepoSshUrl;

    const repoHost = parsedUrl.hostname;
    const repoPath = parsedUrl.pathname;
    const repoId = trimStart(repoPath.split('.git')[0], '/');

    return {
        repoHost,
        repoId
    };
};

const parseRepoProtocol = (repoHost, gitlabHosts) => {
    const urlForHost = gitlabHosts.find(gitlabHost => url.parse(gitlabHost).hostname === repoHost || gitlabHost === repoHost);

    assert(urlForHost, `gitlab-mr.accessTokens does not contain an entry for ${repoHost} (e.g. gitlab-mr.accessTokens["https://${repoHost}"]).`);

    const parsedUrl = url.parse(urlForHost);

    assert(parsedUrl.protocol, `gitlab-mr.accessTokens["${repoHost}"] must have a protocol (e.g. gitlab-mr.accessTokens["https://${repoHost}"]).`);

    return parsedUrl.protocol;
};

const parseGitlabHosts = gitlabCeAccessTokens => {
    const gitlabHosts = Object.keys(gitlabCeAccessTokens);
    gitlabHosts.push('https://gitlab.com');

    return gitlabHosts;
};

module.exports = {
    parseRepoUrl,
    parseRepoProtocol,
    parseGitlabHosts
};
