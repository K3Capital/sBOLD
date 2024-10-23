const path = require('path');

// Map eslint integer values to sonarqube severity strings.
const severity = {
  1: 'MINOR',
  2: 'MAJOR',
};

const timeCost = {
  1: 5,
  2: 10,
};

module.exports = (results, context) => {
  const issues = [];
  results.forEach(result => {
    let relativePath = path.relative('', result.filePath);
    relativePath = relativePath.replace('\\', '/');
    result.messages.forEach(message => {
      issues.push({
        engineId: 'eslint',
        ruleId: message.ruleId,
        severity: severity[message.severity],
        type: 'CODE_SMELL',
        effortMinutes: timeCost[message.severity],
        primaryLocation: {
          message: `${message.message}(${context.rulesMeta[message.ruleId].docs.url})`,
          filePath: relativePath,
          textRange: {
            startLine: message.line,
          },
        },
      });
    });
  });

  return JSON.stringify({ issues });
};
