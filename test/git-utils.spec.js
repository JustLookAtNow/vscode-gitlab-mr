/* global describe, it */
const expect = require('chai').expect;
const gitUtils = require('../src/git-utils');

describe('git-utils', () => {
    describe('parseRepoUrl', () => {
        it('https://', () => {
            const repoUrl = 'https://gitlab.example.com/jasonnutter/test-repo.git';

            const idHost = gitUtils.parseRepoUrl(repoUrl);

            expect(idHost.repoHost).to.equal('gitlab.example.com');
            expect(idHost.repoId).equal('jasonnutter/test-repo');
        });

        it('http://', () => {
            const repoUrl = 'http://localhost/jasonnutter/test-repo.git';

            const idHost = gitUtils.parseRepoUrl(repoUrl);

            expect(idHost.repoHost).to.equal('localhost');
            expect(idHost.repoId).to.equal('jasonnutter/test-repo');
        });

        it('git@', () => {
            const repoUrl = 'git@gitlab.com:jasonnutter/vscode-gitlab-mr-test.git';

            const idHost = gitUtils.parseRepoUrl(repoUrl);

            expect(idHost.repoHost).to.equal('gitlab.com');
            expect(idHost.repoId).to.equal('jasonnutter/vscode-gitlab-mr-test');
        });

        it('ssh://', () => {
            const repoUrl = 'ssh://git@gitlab.example.com:22448/jasonnutter/test-repo.git';

            const idHost = gitUtils.parseRepoUrl(repoUrl);

            expect(idHost.repoHost).to.equal('gitlab.example.com');
            expect(idHost.repoId).to.equal('jasonnutter/test-repo');
        });
    });

    describe('repoWebProtocol', () => {
        describe('parses protocol successfully', () => {
            const gitlabHosts = [
                'http://gitlab.example.com',
                'https://gitlab-test.example.com',
                'https://gitlab.com'
            ];

            it('http (Gitlab CE)', () => {
                const repoHost = 'gitlab.example.com';
                const protocol = gitUtils.parseRepoProtocol(repoHost, gitlabHosts);

                expect(protocol).to.equal('http:');
            });

            it('https (Gitlab CE)', () => {
                const repoHost = 'gitlab-test.example.com';
                const protocol = gitUtils.parseRepoProtocol(repoHost, gitlabHosts);

                expect(protocol).to.equal('https:');
            });

            it('https (Gitlab.com)', () => {
                const repoHost = 'gitlab.com';
                const protocol = gitUtils.parseRepoProtocol(repoHost, gitlabHosts);

                expect(protocol).to.equal('https:');
            });
        });

        describe('throws when Gitlab hosts are not properly configured', () => {
            it('Entry missing', () => {
                const gitlabHosts = [];

                const repoHost = 'gitlab.example.com';

                const func = gitUtils.parseRepoProtocol.bind(null, repoHost, gitlabHosts);

                expect(func).to.throw(`gitlab-mr.accessTokens does not contain an entry for ${repoHost} (e.g. gitlab-mr.accessTokens["https://${repoHost}"]).`);
            });

            it('Protocol missing', () => {
                const gitlabHosts = [
                    'gitlab.example.com'
                ];

                const repoHost = 'gitlab.example.com';

                const func = gitUtils.parseRepoProtocol.bind(null, repoHost, gitlabHosts);

                expect(func).to.throw(`gitlab-mr.accessTokens["${repoHost}"] must have a protocol (e.g. gitlab-mr.accessTokens["https://${repoHost}"]).`);
            });
        });
    });

    describe('parseGitlabHosts', () => {
        const gitlabCeAccessTokens = {
            'http://gitlab.example.com': '',
            'https://gitlab-test.example.com': ''
        };

        it('parses Gitlab hosts correctly (including Gitlab.com)', () => {
            const gitlabHosts = gitUtils.parseGitlabHosts(gitlabCeAccessTokens);

            expect(gitlabHosts).to.deep.equal([
                'http://gitlab.example.com',
                'https://gitlab-test.example.com',
                'https://gitlab.com'
            ]);
        });
    });
});
