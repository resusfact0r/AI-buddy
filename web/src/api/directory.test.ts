import { describe, expect, it } from 'vitest';
import { enrichRequest, type Directory } from './directory';
import { normalizeAgent, normalizeRequest, shortRequestNumber } from './wire';
import { RequestSchema, type WorkRequest } from './schemas';

const HEX = 'b09504170b2f439357a5d546d5436d88535c57b278e1c2d8f018eb14021a9edc';
const dir: Directory = {
  people: new Map([
    ['anna', 'Анна'],
    ['elena', 'Елена'],
  ]),
  systems: new Map([['grafana', 'Grafana']]),
};

const raw = (over: Record<string, unknown>) =>
  RequestSchema.parse(
    normalizeRequest({
      id: HEX,
      user_id: 'anna',
      status: 'approved',
      decided_by: 'elena',
      created_at: '2026-11-16T09:03:26Z',
      ...over,
    }),
  ) as WorkRequest;

describe('заявки с живого бэка', () => {
  it('короткий номер вместо длинного id', () => {
    expect(shortRequestNumber(HEX)).toBe('№ B09504');
    expect(shortRequestNumber('seed-access-0')).toBe('seed-access-0');
    expect(
      raw({
        type: 'leave',
        payload: { date_from: '2026-11-20', date_to: '2026-11-20', reason_type: 'day_off' },
      }).number,
    ).toBe('№ B09504');
  });

  it('имена автора и согласующего, название системы', () => {
    const r = enrichRequest(
      raw({ type: 'access', payload: { system_code: 'grafana', reason: 'нужно' } }),
      dir,
    );
    expect(r.author.display_name).toBe('Анна');
    expect(r.decided_by?.display_name).toBe('Елена');
    expect(r.type === 'access' && r.access.system_name).toBe('Grafana');
  });

  it('не трогает уже готовые значения и неизвестные коды', () => {
    const r = enrichRequest(raw({ user_id: 'boris', type: 'access', payload: { system_code: 'vpn' } }), dir);
    expect(r.author.display_name).toBe('boris');
    expect(r.type === 'access' && r.access.system_name).toBe('vpn');
  });
});

describe('результат подтверждения', () => {
  it('done с созданной заявкой → статус заявки и короткий номер', () => {
    const v = normalizeAgent('action_result', {
      action_id: 'a',
      status: 'done',
      data: { id: HEX, status: 'pending' },
    }) as Record<string, unknown>;
    expect(v.status).toBe('pending');
    expect(v.request_numbers).toEqual(['№ B09504']);
  });

  it('доступы: статус заявок из results; done для задачи не меняется', () => {
    const access = normalizeAgent('action_result', {
      action_id: 'a',
      status: 'done',
      data: { results: [{ ok: true, request: { id: HEX, status: 'pending' } }] },
    }) as Record<string, unknown>;
    expect(access.status).toBe('pending');
    const task = normalizeAgent('action_result', { action_id: 't', status: 'done', data: {} }) as Record<
      string,
      unknown
    >;
    expect(task.status).toBe('done');
  });
});
