import {
  ActionProposalSchema,
  ChatHistorySchema,
  daysInclusive,
  LeaveFormSchema,
  RequestSchema,
  todayIso,
} from './schemas';
import { addDays } from '@/lib/dates';

describe('LeaveFormSchema', () => {
  const today = todayIso();
  it('принимает корректный отгул', () => {
    expect(
      LeaveFormSchema.safeParse({ date_from: today, date_to: addDays(today, 1), leave_type: 'day_off' })
        .success,
    ).toBe(true);
  });
  it('дата в прошлом', () => {
    const r = LeaveFormSchema.safeParse({
      date_from: addDays(today, -1),
      date_to: today,
      leave_type: 'day_off',
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(['date_from']);
  });
  it('from > to', () => {
    const r = LeaveFormSchema.safeParse({
      date_from: addDays(today, 3),
      date_to: addDays(today, 1),
      leave_type: 'day_off',
    });
    expect(r.error!.issues.map((i) => i.message)).toContain('Дата окончания раньше даты начала');
  });
  it('не больше 14 дней', () => {
    const r = LeaveFormSchema.safeParse({
      date_from: today,
      date_to: addDays(today, 14),
      leave_type: 'day_off',
    });
    expect(r.error!.issues[0]!.message).toMatch(/14 дней/);
    expect(
      LeaveFormSchema.safeParse({ date_from: today, date_to: addDays(today, 13), leave_type: 'day_off' })
        .success,
    ).toBe(true);
  });
  it('неверный формат даты', () => {
    expect(
      LeaveFormSchema.safeParse({ date_from: '13.11.2026', date_to: today, leave_type: 'day_off' }).success,
    ).toBe(false);
  });
});

describe('daysInclusive', () => {
  it('считает включительно и через границу месяца', () => {
    expect(daysInclusive('2026-11-13', '2026-11-13')).toBe(1);
    expect(daysInclusive('2026-11-30', '2026-12-02')).toBe(3);
  });
});

describe('RequestSchema', () => {
  const base = {
    id: '1',
    number: 'REQ-1',
    status: 'pending',
    author: { id: 'u', display_name: 'A' },
    created_at: '2026-11-10T10:00:00Z',
  };
  it('leave и access по discriminator', () => {
    expect(
      RequestSchema.parse({
        ...base,
        type: 'leave',
        leave: { date_from: '2026-11-13', date_to: '2026-11-13', leave_type: 'day_off' },
      }).type,
    ).toBe('leave');
    expect(
      RequestSchema.parse({ ...base, type: 'access', access: { system_id: 's', system_name: 'GitLab' } })
        .type,
    ).toBe('access');
  });
  it('отклоняет неизвестный статус и несоответствие типа', () => {
    expect(
      RequestSchema.safeParse({
        ...base,
        status: 'weird',
        type: 'access',
        access: { system_id: 's', system_name: 'x' },
      }).success,
    ).toBe(false);
    expect(
      RequestSchema.safeParse({ ...base, type: 'leave', access: { system_id: 's', system_name: 'x' } })
        .success,
    ).toBe(false);
  });
});

describe('ActionProposalSchema', () => {
  it('валидирует params по type', () => {
    expect(
      ActionProposalSchema.safeParse({
        action_id: 'a',
        type: 'task_status',
        params: { task_id: 't', task_title: 'T', status: 'done' },
      }).success,
    ).toBe(true);
    expect(
      ActionProposalSchema.safeParse({ action_id: 'a', type: 'access_request', params: { systems: [] } })
        .success,
    ).toBe(false);
    expect(ActionProposalSchema.safeParse({ action_id: 'a', type: 'unknown', params: {} }).success).toBe(
      false,
    );
  });
});

describe('ChatHistorySchema', () => {
  it('принимает пустую историю', () => {
    expect(ChatHistorySchema.parse({ conversation_id: null, messages: [] }).messages).toEqual([]);
  });
});
