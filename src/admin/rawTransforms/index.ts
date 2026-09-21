import { artsEdTransform } from './artsEd';
import { chronicAbsenteeismTransform } from './chronicAbsenteeism';
import { graduationTransform } from './graduation';
import { schoolQualityTransform } from './schoolQuality';
import { elaTransform, mathTransform } from './stateTest';
import { suspensionsTransform } from './suspensions';
import { familySurveyTransform, studentSurveyTransform, teacherSurveyTransform } from './surveys';
import { tempHousingTransform } from './tempHousing';
import type { RawTransform } from './types';

const ALL: readonly RawTransform[] = [
  artsEdTransform,
  suspensionsTransform,
  tempHousingTransform,
  mathTransform,
  elaTransform,
  chronicAbsenteeismTransform,
  graduationTransform,
  schoolQualityTransform,
  familySurveyTransform,
  teacherSurveyTransform,
  studentSurveyTransform,
];

const byId = new Map(ALL.map((t) => [t.datasetId, t]));

export function getRawTransform(datasetId: string): RawTransform | undefined {
  return byId.get(datasetId);
}

export type { RawFile, RawTransform, TransformIssue, TransformResult, TransformContext } from './types';
