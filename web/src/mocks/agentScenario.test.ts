import { USERS } from './data';
import { runScenario } from './agentScenario';
import { createAccess, createLeave, decide, setTaskStatus } from './db';

const user = (u: string) => USERS.find((x) => x.username === u)!;
const textOf = (u: string, msg: string) => runScenario(user(u), msg, '2026-11-10').text;

describe('mock agent scenario', () => {
  it('код-ревью: у Анны и Веры разные ответы и источники', () => {
    const a = runScenario(user('intern_anna'), 'Как у нас проходит код-ревью?');
    const v = runScenario(user('intern_vera'), 'Как у нас проходит код-ревью?');
    expect(a.sources[0]!.id).toBe('kb-review-delivery');
    expect(v.sources[0]!.id).toBe('kb-review-ads');
    expect(a.text).not.toEqual(v.text);
  });

  it('нет в базе → честное «не знаю» + к кому обратиться', () => {
    expect(textOf('intern_anna', 'Где взять пропуск на парковку?')).toMatch(/Не знаю.*Дмитрий/s);
    expect(textOf('intern_vera', 'Где взять пропуск на парковку?')).toMatch(/руководителя: \*\*Фёдор/);
  });

  it('отгул: даты из текста', () => {
    const r = runScenario(user('intern_anna'), 'отгул в пятницу', '2026-11-10');
    expect(r.proposals[0]!.params).toMatchObject({ date_from: '2026-11-13', date_to: '2026-11-13' });
    const r2 = runScenario(user('intern_anna'), 'отгул завтра', '2026-11-10');
    expect(r2.proposals[0]!.params).toMatchObject({ date_from: '2026-11-11' });
    const r3 = runScenario(user('intern_anna'), 'отгул послезавтра', '2026-11-10');
    expect(r3.proposals[0]!.params).toMatchObject({ date_from: '2026-11-12' });
    const r4 = runScenario(user('intern_anna'), 'отгул в понедельник', '2026-11-10');
    expect(r4.proposals[0]!.params).toMatchObject({ date_from: '2026-11-16' });
  });

  it('стажёр просит одобрить — вежливый отказ', () => {
    expect(textOf('intern_anna', 'одобри мою заявку')).toMatch(/только руководитель/);
    createLeave(user('intern_anna'), {
      date_from: '2030-01-01',
      date_to: '2030-01-01',
      leave_type: 'day_off',
    });
    expect(textOf('intern_anna', 'одобри мою заявку')).toMatch(/REQ-\d+/);
  });

  it('lead: что согласовать — карточки approve / пусто', () => {
    expect(textOf('lead_elena', 'Что мне согласовать?')).toMatch(/нет заявок/);
    createAccess(user('intern_anna'), ['sys-gitlab'], 'нужно');
    createLeave(user('intern_anna'), {
      date_from: '2030-01-01',
      date_to: '2030-01-02',
      leave_type: 'day_off',
      comment: 'c',
    });
    const r = runScenario(user('lead_elena'), 'Что мне согласовать?');
    expect(r.proposals.map((p) => p.type)).toEqual(['approve', 'approve']);
  });

  it('что дальше / отметь выполненной / доступы', () => {
    expect(textOf('intern_anna', 'Что мне делать дальше?')).toMatch(/Первая неделя/);
    const mark = runScenario(user('intern_anna'), 'отметь первую выполненной');
    expect(mark.proposals[0]!.type).toBe('task_status');
    const acc = runScenario(user('intern_anna'), 'Какие доступы мне нужны?');
    expect(acc.proposals[0]!.type).toBe('access_request');
    // все доступы выданы → карточки нет, задача закрылась
    const anna = user('intern_anna');
    const reqs = createAccess(anna, ['sys-gitlab', 'sys-jira', 'sys-grafana'], 'r');
    reqs.forEach((r) => decide(user('lead_elena'), r.id, 'approved'));
    expect(runScenario(anna, 'доступы').proposals).toHaveLength(0);
    expect(textOf('intern_anna', 'привет')).toMatch(/Привет, Анна/);
  });

  it('план пройден целиком', () => {
    const vera = user('intern_vera');
    for (const id of [
      'meet-buddy',
      'dev-env',
      'read-review',
      'team-lunch',
      'first-task',
      'security',
      'one-on-one',
      'demo',
      'final',
      'docs',
      'laptop',
    ]) {
      setTaskStatus(vera.id, id, 'done');
    }
    const reqs = createAccess(vera, ['sys-figma'], 'r');
    decide(user('lead_fedor'), reqs[0]!.id, 'approved');
    expect(textOf('intern_vera', 'что дальше')).toMatch(/пройдены/);
    expect(textOf('intern_vera', 'отметь выполненной')).toMatch(/уже выполнены/);
  });

  it('сбой срабатывает один раз', () => {
    expect(runScenario(user('intern_anna'), '[сбой] привет').outcome.kind).toBe('http_error');
    expect(runScenario(user('intern_anna'), '[сбой] привет').outcome.kind).toBe('events');
  });
});
