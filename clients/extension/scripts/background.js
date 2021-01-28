'use strict';

/**
 * builds the correct report url and calls it.
 * @param {string} url
 */
function openReport(url) {
  const apiUrl = new URL('https://googlechrome.github.io/lighthouse/viewer/');
  apiUrl.searchParams.append('psiurl', url);
  window.open(apiUrl.href);
}

// TODO: write your code here
