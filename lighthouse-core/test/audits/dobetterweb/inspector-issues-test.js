/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const InspectorIssuesAudit =
  require('../../../audits/dobetterweb/inspector-issues.js');

/* eslint-env jest */

describe('Has inspector issues audit', () => {
  let issues;
  beforeEach(() => {
    issues = {
      mixedContent: [],
      sameSiteCookies: [],
      blockedByResponse: [],
      heavyAds: [],
      contentSecurityPolicy: [],
    };
  });

  it('passes when no issues are found', () => {
    const auditResult = InspectorIssuesAudit.audit({
      InspectorIssues: issues,
    });
    expect(auditResult.score).toBe(1);
    expect(auditResult.details.items).toHaveLength(0);
  });

  it('correctly displays mixed content issues', () => {
    const mixedContentIssues = [
      {
        resolutionStatus: 'MixedContentBlocked',
        insecureURL: 'www.mixedcontent.com',
        mainResourceURL: 'www.mixedcontent.com',
      },
      {
        resolutionStatus: 'MixedContentWarning',
        insecureURL: 'www.insecureurl.com',
        mainResourceURL: 'www.inscureurl.com',
        request: {
          requestId: '1',
          url: 'www.insecureurl.com/request',
        },
      },
    ];
    issues.mixedContent.push(...mixedContentIssues);

    const auditResult = InspectorIssuesAudit.audit({
      InspectorIssues: issues,
    });
    expect(auditResult.score).toBe(0);
    expect(auditResult.details.items[0]).toMatchObject({
      issueType: 'Mixed content',
      subItems: {
        type: 'subitems',
        items: [
          {
            // Fell back to `mainResourceURL` since no `request`.
            url: 'www.mixedcontent.com',
          },
          {
            url: 'www.insecureurl.com/request',
          },
        ],
      },
    });
  });

  it('correctly displays SameSite cookie issues', () => {
    const samesiteIssues = [
      {
        cookieUrl: 'www.samesitecookies.com',
      },
      {
        request: {
          requestId: '2',
          url: 'www.samesiterequest.com',
        },
      },
    ];
    issues.sameSiteCookies.push(...samesiteIssues);

    const auditResult = InspectorIssuesAudit.audit({
      InspectorIssues: issues,
    });
    expect(auditResult.score).toBe(0);
    expect(auditResult.details.items[0]).toMatchObject({
      issueType: 'SameSite cookie',
      subItems: {
        type: 'subitems',
        items: [
          {
            // Fell back to `mainResourceURL` since no `request`.
            url: 'www.samesitecookies.com',
          },
          {
            url: 'www.samesiterequest.com',
          },
        ],
      },
    });
  });

  it('correctly displays Blocked By Response issues', () => {
    const blockedByResponseIssues = [
      {
        reason: 'CoepFrameResourceNeedsCoepHeader',
        request: {
          url: 'www.coep.com',
        },
      },
      {
        reason: 'CoopSandboxedIFrameCannotNavigateToCoopPage',
        request: {
          url: 'www.coop.com',
        },
      },
      {
        reason: 'CorpNotSameOriginAfterDefaultedToSameOriginByCoep',
        request: {
          requestId: '3',
        },
      },
      {
        reason: 'CorpNotSameOrigin',
        request: {
          url: 'www.same-origin.com',
        },
      },
      {
        reason: 'CorpNotSameSite',
        request: {
          url: 'www.same-site.com',
        },
      },
    ];
    issues.blockedByResponse.push(...blockedByResponseIssues);

    const auditResult = InspectorIssuesAudit.audit({
      InspectorIssues: issues,
    });
    expect(auditResult.score).toBe(0);
    expect(auditResult.details.items[0]).toMatchObject({
      issueType: {
        formattedDefault: 'Blocked by cross-origin policy',
      },
      subItems: {
        type: 'subitems',
        // should only be 4 subitems as one of the issues doesn't have a request url
        items: [
          {
            url: 'www.coep.com',
          },
          {
            url: 'www.coop.com',
          },
          {
            url: 'www.same-origin.com',
          },
          {
            url: 'www.same-site.com',
          },
        ],
      },
    });
  });

  it('correctly displays Heavy Ads issues', () => {
    const heavyAdsIssues = [
      {
        resolution: 'HeavyAdBlocked',
        reason: 'NetworkTotalLimit',
      },
      {
        resolution: 'HeavyAdBlocked',
        reason: 'CpuTotalLimit',
      },
      {
        resolution: 'HeavyAdBlocked',
        reason: 'CpuPeakLimit',
      },
    ];
    issues.heavyAds.push(...heavyAdsIssues);

    const auditResult = InspectorIssuesAudit.audit({
      InspectorIssues: issues,
    });
    expect(auditResult.score).toBe(0);
    expect(auditResult.details.items[0]).toMatchObject({
      issueType: {
        formattedDefault: 'Heavy resource usage by ads',
      },
    });
  });

  it('correctly displays Content Security Policy issues', () => {
    const cspIssues = [
      {
        contentSecurityPolicyViolationType: 'kInlineViolation',
        blockedURL: 'www.csp.com/inline-violation',
      },
      {
        contentSecurityPolicyViolationType: 'kEvalViolation',
        blockedURL: 'www.csp.com/eval-violation',
      },
      {
        contentSecurityPolicyViolationType: 'kURLViolation',
        blockedURL: 'www.csp.com/url-violation',
      },
      // These last two should be filtered out as they aren't supported yet
      {
        contentSecurityPolicyViolationType: 'kTrustedTypesSinkViolation',
        blockedURL: 'www.csp.com/sink-violation',
      },
      {
        contentSecurityPolicyViolationType: 'kTrustedTypesPolicyViolation',
        blockedURL: 'www.csp.com/policy-violation',
      },
    ];
    issues.contentSecurityPolicy.push(...cspIssues);

    const auditResult = InspectorIssuesAudit.audit({
      InspectorIssues: issues,
    });
    expect(auditResult.score).toBe(0);
    expect(auditResult.details.items[0]).toMatchObject({
      issueType: 'Content security policy',
      subItems: {
        type: 'subitems',
        items: [
          {
            url: 'www.csp.com/inline-violation',
          },
          {
            url: 'www.csp.com/eval-violation',
          },
          {
            url: 'www.csp.com/url-violation',
          },
        ],
      },
    });
  });
});
