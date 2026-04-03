'use strict';

// Housing imputation value when rectory/housing is provided
const HOUSING_VALUE = 20000;

// ASA threshold for Senior Rector vs Solo Rector in CPG mapping
const SENIOR_RECTOR_ASA_THRESHOLD = 400;

// Quality score threshold for extended -> extended_hidden visibility
const QUALITY_VISIBILITY_THRESHOLD = 50;

// Similar positions scoring
const SIMILAR_ASA_TOLERANCE = 0.25;  // +/- 25%
const SIMILAR_COMP_TOLERANCE = 0.20; // +/- 20%
const SIMILAR_MIN_SCORE = 3;
const SIMILAR_MAX_RESULTS = 15;

module.exports = {
  HOUSING_VALUE,
  SENIOR_RECTOR_ASA_THRESHOLD,
  QUALITY_VISIBILITY_THRESHOLD,
  SIMILAR_ASA_TOLERANCE,
  SIMILAR_COMP_TOLERANCE,
  SIMILAR_MIN_SCORE,
  SIMILAR_MAX_RESULTS,
};
