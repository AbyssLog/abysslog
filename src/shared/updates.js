(function exposeUpdates(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssUpdates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SEMVER_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

  function parseSemver(value) {
    if (typeof value !== 'string' || value.length > 64) {
      throw new TypeError('Version must be a short string');
    }

    const match = SEMVER_PATTERN.exec(value);
    if (!match) throw new TypeError('Version is not valid semantic versioning');

    const core = match.slice(1, 4).map(part => Number(part));
    if (core.some(part => !Number.isSafeInteger(part))) {
      throw new TypeError('Version number is too large');
    }

    const prerelease = match[4] ? match[4].split('.') : [];
    if (prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
      throw new TypeError('Numeric prerelease identifiers cannot contain leading zeroes');
    }

    return {
      version: value.replace(/^v/, ''),
      major: core[0],
      minor: core[1],
      patch: core[2],
      prerelease,
    };
  }

  function comparePrereleaseIdentifier(left, right) {
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (!Number.isSafeInteger(leftNumber) || !Number.isSafeInteger(rightNumber)) {
        throw new TypeError('Prerelease number is too large');
      }
      return Math.sign(leftNumber - rightNumber);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  function compareSemver(leftValue, rightValue) {
    const left = parseSemver(leftValue);
    const right = parseSemver(rightValue);

    for (const key of ['major', 'minor', 'patch']) {
      if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
    }

    if (left.prerelease.length === 0 || right.prerelease.length === 0) {
      if (left.prerelease.length === right.prerelease.length) return 0;
      return left.prerelease.length === 0 ? 1 : -1;
    }

    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index++) {
      if (left.prerelease[index] === undefined) return -1;
      if (right.prerelease[index] === undefined) return 1;
      const result = comparePrereleaseIdentifier(
        left.prerelease[index],
        right.prerelease[index]
      );
      if (result !== 0) return result;
    }
    return 0;
  }

  return {
    compareSemver,
    parseSemver,
  };
});
