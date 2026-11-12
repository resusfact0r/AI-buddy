import { USERS } from './data';
import {
  createAccess,
  createLeave,
  decide,
  MockHttpError,
  pendingFor,
  requestById,
  setTaskStatus,
  userByToken,
  withIdempotency,
} from './db';

const u = (n: string) => USERS.find((x) => x.username === n)!;

describe('mock db rules', () => {
  it('права и конфликты', () => {
    expect(() => userByToken('Bearer bad')).toThrow(MockHttpError);
    expect(() => pendingFor(u('intern_anna'))).toThrow(/руководител/);
    expect(() =>
      createLeave(u('lead_elena'), { date_from: '2030-01-01', date_to: '2030-01-01', leave_type: 'day_off' }),
    ).toThrow(/стажёр/);
    expect(() => setTaskStatus('u-anna', 'nope', 'done')).toThrow(/не найдена/);
    expect(() => createAccess(u('intern_anna'), [], 'r')).toThrow(MockHttpError);
    expect(() => createAccess(u('intern_anna'), ['sys-mm'], 'r')).toThrow(/уже есть/);
    expect(() => createAccess(u('intern_anna'), ['sys-zzz'], 'r')).toThrow(/не найдена/);
    const [r] = createAccess(u('intern_anna'), ['sys-jira'], 'r');
    expect(() => createAccess(u('intern_anna'), ['sys-jira'], 'r')).toThrow(/уже запрошен/);
    // чужой руководитель не видит заявку
    expect(() => requestById(u('lead_fedor'), r!.id)).toThrow(/Нет доступа/);
    expect(() => requestById(u('lead_elena'), 'zzz')).toThrow(/не найдена/);
    decide(u('lead_elena'), r!.id, 'rejected', 'позже');
    expect(() => decide(u('lead_elena'), r!.id, 'approved')).toThrow(/уже отклонена/);
  });

  it('валидация дат отгула на сервере', () => {
    try {
      createLeave(u('intern_anna'), { date_from: 'x', date_to: '2030-01-01', leave_type: 'day_off' });
    } catch (e) {
      expect((e as MockHttpError).details).toEqual({ fields: { date_from: 'Укажите дату начала' } });
    }
    expect(() =>
      createLeave(u('intern_anna'), {
        date_from: '2030-01-05',
        date_to: '2030-01-01',
        leave_type: 'day_off',
      }),
    ).toThrow(MockHttpError);
  });

  it('идемпотентность', () => {
    const a = withIdempotency('k', () => ({ n: Math.random() }));
    const b = withIdempotency('k', () => ({ n: Math.random() }));
    expect(a).toBe(b);
  });
});
