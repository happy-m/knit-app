// 뜨기 화면 들머리: 파트 종류에 맞는 화면을 연다
import * as db from '../../db.js';
import { go } from '../../core.js';
import { isText, isCirc } from '../../model/knitting.js';
import { viewChartKnit } from './chart.js';
import { viewCircKnit } from './circ.js';
import { viewTextKnit } from './text.js';

export async function viewKnit(id) {
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  if (isText(part)) return viewTextKnit(part);
  if (isCirc(part)) return viewCircKnit(part);
  return viewChartKnit(part);
}
