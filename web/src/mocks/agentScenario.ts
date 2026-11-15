import type { ActionProposal, AgentEvent, Source } from '@/api/schemas';
import { ARTICLES, type MockUser } from './data';
import { addDays, formatDay, formatRange, nextWeekday, toIso } from '@/lib/dates';
import {
  accessFor,
  buddyOf,
  leadOf,
  markFailedOnce,
  nextStepsFor,
  pendingFor,
  progressFor,
  requestsFor,
  teamOf,
} from './db';

export interface ScriptStep {
  event: AgentEvent;
  /** Пауза перед событием, мс (масштабируется mockTiming.scale). */
  delay: number;
}

/** Специальные исходы для имитации сбоев. */
export type ScriptOutcome = { kind: 'events'; steps: ScriptStep[] } | { kind: 'http_error'; status: number };

const src = (id: string): Source => {
  const a = ARTICLES.find((x) => x.id === id)!;
  return { id: a.id, title: a.title };
};

let actionSeq = 0;
const newActionId = () => `act-${Date.now().toString(36)}-${++actionSeq}`;

function tokens(text: string, perChunk = 3): ScriptStep[] {
  const words = text.split(/(\s+)/);
  const out: ScriptStep[] = [];
  for (let i = 0; i < words.length; i += perChunk * 2) {
    out.push({
      event: { type: 'token', data: { text: words.slice(i, i + perChunk * 2).join('') } },
      delay: 35,
    });
  }
  return out;
}

const status = (text: string, delay = 350): ScriptStep => ({
  event: { type: 'status', data: { text } },
  delay,
});
const sources = (list: Source[]): ScriptStep => ({
  event: { type: 'sources', data: { sources: list } },
  delay: 120,
});
const proposal = (p: ActionProposal): ScriptStep => ({
  event: { type: 'action_proposal', data: p },
  delay: 250,
});

const WEEKDAYS: [RegExp, number][] = [
  [/понедельник/, 1],
  [/вторник/, 2],
  [/сред[уа]/, 3],
  [/четверг/, 4],
  [/пятниц/, 5],
];

function guessLeaveDates(text: string, today: string): { from: string; to: string } {
  if (/послезавтра/.test(text)) return { from: addDays(today, 2), to: addDays(today, 2) };
  if (/завтра/.test(text)) return { from: addDays(today, 1), to: addDays(today, 1) };
  for (const [re, wd] of WEEKDAYS) {
    if (re.test(text)) {
      const d = nextWeekday(today, wd);
      return { from: d, to: d };
    }
  }
  return { from: nextWeekday(today, 5), to: nextWeekday(today, 5) };
}

export interface ScenarioResult {
  outcome: ScriptOutcome;
  /** Итоговый текст ассистента — для истории. */
  text: string;
  sources: Source[];
  proposals: ActionProposal[];
}

/** Мини-«агент» для моков: маршрутизация по ключевым словам → набор событий SSE. */
export function runScenario(user: MockUser, message: string, today = toIso(new Date())): ScenarioResult {
  const text = message.toLowerCase();
  const steps: ScriptStep[] = [];
  let answer = '';
  let srcs: Source[] = [];
  const proposals: ActionProposal[] = [];
  const say = (s: string) => {
    answer += s;
    steps.push(...tokens(s));
  };
  const propose = (p: ActionProposal) => {
    proposals.push(p);
    steps.push(proposal(p));
  };
  const cite = (list: Source[]) => {
    srcs = list;
    steps.push(sources(list));
  };

  // Имитация сбоев для демо: первый запрос с «[сбой]» падает, повтор проходит.
  if (text.includes('[сбой]') && markFailedOnce(`${user.id}:${text}`)) {
    return { outcome: { kind: 'http_error', status: 503 }, text: '', sources: [], proposals: [] };
  }
  if (text.includes('[ошибка]')) {
    steps.push(status('Думаю…'));
    steps.push({
      event: {
        type: 'error',
        data: {
          code: 'upstream_unavailable',
          message: 'Языковая модель временно недоступна',
          retryable: true,
        },
      },
      delay: 600,
    });
    return { outcome: { kind: 'events', steps }, text: '', sources: [], proposals: [] };
  }
  const isLead = user.role === 'lead';
  const lead = leadOf(user);
  const buddy = buddyOf(user);

  if (isLead && /(соглас|одобр|заявк)/.test(text)) {
    steps.push(status('Смотрю заявки на согласование…'));
    const pending = pendingFor(user);
    if (pending.length === 0) {
      say('Сейчас нет заявок, которые ждут вашего решения.');
    } else {
      say(`Ждут вашего решения: **${pending.length}**. Подготовил карточки — проверьте и подтвердите:\n`);
      for (const r of pending.slice(0, 5)) {
        propose({
          action_id: newActionId(),
          type: 'approve',
          title: `Одобрить ${r.number}`,
          params: {
            request_id: r.id,
            request_number: r.number,
            request_type: r.type,
            author_name: r.author.display_name,
            summary:
              r.type === 'leave'
                ? `Отгул: ${formatRange(r.leave.date_from, r.leave.date_to)}`
                : `Доступ: ${r.access.system_name}`,
            reason: r.type === 'leave' ? (r.leave.comment ?? null) : (r.access.reason ?? null),
          },
        });
      }
    }
  } else if (!isLead && /(одобри|согласуй|подтверди мою)/.test(text)) {
    steps.push(status('Проверяю права…'));
    const mine = requestsFor(user, null, 'pending')[0];
    say(
      'Одобрять заявки может только руководитель команды — у меня нет таких прав от вашего имени, и это правильно. ' +
        (mine
          ? `Ваша заявка **${mine.number}** уже на согласовании у ${lead?.display_name ?? 'руководителя'}. Я сообщу, когда статус изменится.`
          : `Если нужно ускорить — напишите ${lead?.display_name ?? 'руководителю'} (${lead?.contact ?? ''}).`),
    );
  } else if (/(отгул|отпуск|выходн)/.test(text)) {
    steps.push(status('Ищу в базе знаний…'));
    cite([src('kb-leave')]);
    steps.push(status('Готовлю заявку…', 200));
    const { from, to } = guessLeaveDates(text, today);
    say(
      `Да, руководителя нужно предупредить минимум **за 2 рабочих дня** — заявку согласует ${lead?.display_name ?? 'руководитель'}. ` +
        `Я подготовил заявку на отгул на **${formatRange(from, to)}**. Проверьте даты и подтвердите — после этого она уйдёт на согласование.`,
    );
    propose({
      action_id: newActionId(),
      type: 'leave_request',
      title: 'Заявка на отгул',
      params: { date_from: from, date_to: to, leave_type: 'day_off', comment: null },
    });
  } else if (/(отметь|выполнен|сделал|закрой)/.test(text)) {
    steps.push(status('Смотрю план адаптации…'));
    const step = nextStepsFor(user.id).steps.find((t) => !t.auto_complete);
    if (!step) {
      say('Все задачи текущего этапа, которые можно отметить вручную, уже выполнены. Отличная работа!');
    } else {
      say(`Отмечу задачу «${step.title}» выполненной — подтвердите, пожалуйста:`);
      propose({
        action_id: newActionId(),
        type: 'task_status',
        title: 'Обновить план',
        params: { task_id: step.id, task_title: step.title, status: 'done' },
      });
    }
  } else if (/(дальше|следующ|что мне делать|с чего начать|план)/.test(text)) {
    steps.push(status('Смотрю план адаптации…'));
    const ns = nextStepsFor(user.id);
    const p = progressFor(user.id);
    cite([src('kb-onboarding')]);
    if (!ns.current_stage) {
      say('Все этапы плана адаптации пройдены — поздравляю!');
    } else {
      say(
        `Вы на этапе **«${ns.current_stage.title}»**, план выполнен на **${p.percent}%**. Следующие шаги:\n\n` +
          ns.steps
            .map(
              (t, i) =>
                `${i + 1}. **${t.title}**${t.auto_complete ? ' — закроется сам, когда выдадут доступы' : ''}${t.required ? '' : ' (необязательно)'}`,
            )
            .join('\n') +
          '\n\nСкажите «отметь первую выполненной», когда закончите — я обновлю план.',
      );
    }
  } else if (/(доступ)/.test(text)) {
    steps.push(status('Проверяю доступы…'));
    cite([src('kb-access')]);
    const ov = accessFor(user);
    const label = { granted: 'есть', requested: 'запрошен', missing: 'не хватает' } as const;
    say(
      `Для команды «${teamOf(user)?.name}» нужны такие системы — выдано **${ov.granted} из ${ov.total}**:\n\n` +
        ov.systems
          .map((s) => `- **${s.name}** — ${label[s.status]}${s.required ? '' : ' (необязательно)'}`)
          .join('\n') +
        '\n',
    );
    const missing = ov.systems.filter((s) => s.status === 'missing');
    if (missing.length) {
      say('\nОтметил недостающие — снимите галочки с лишних и подтвердите, запросы уйдут руководителю.');
      propose({
        action_id: newActionId(),
        type: 'access_request',
        title: 'Запрос доступов',
        params: {
          systems: missing.map((s) => ({ id: s.id, name: s.name, purpose: s.purpose })),
          reason: 'Нужны для задач первой недели по плану адаптации',
        },
      });
    } else {
      say('\nНедостающих доступов нет — все уже выданы или запрошены.');
    }
  } else if (/(ревью|review|мр|merge)/.test(text)) {
    steps.push(status('Ищу в базе знаний команды…'));
    const team = teamOf(user);
    if (team?.id === 't-delivery') {
      cite([src('kb-review-delivery')]);
      say(
        'В «Доставке» каждый MR смотрят **два ревьюера** — наставник и любой бэкендер команды. ' +
          'MR до **400 строк**, ревьюеров назначает бот в **#delivery-review**, первый ответ — в течение **4 рабочих часов**. ' +
          'Перед ревью линтер и тесты должны быть зелёными.',
      );
    } else if (team?.id === 't-ads-front') {
      cite([src('kb-review-ads')]);
      say(
        'Во «Фронтенде Объявлений» достаточно **одного аппрува** от участника команды (для дизайн-системы — плюс дизайнер). ' +
          'К MR прикладывайте **скриншоты или ссылку на Storybook**, ревью раздаётся в **#ads-front-review**, SLA — **1 рабочий день**.',
      );
    } else {
      say('Не нашёл правил код-ревью для вашей команды.');
    }
  } else if (/(привет|здравств|кто ты|что ты умеешь)/.test(text)) {
    say(
      `Привет, ${user.display_name.split(' ')[0]}! Я AI-buddy. Подскажу, что делать дальше по плану адаптации, ` +
        'отвечу на вопросы о команде и инструментах, помогу оформить отгул и запросить доступы.',
    );
  } else {
    steps.push(status('Ищу в базе знаний…', 500));
    const who = buddy ?? lead;
    say(
      'Не знаю — в базе знаний вашей команды об этом ничего нет, а придумывать не хочу. ' +
        (who
          ? `Лучше спросить ${buddy ? 'наставника' : 'руководителя'}: **${who.display_name}** (${who.contact}).`
          : 'Лучше спросить руководителя команды.'),
    );
  }

  return { outcome: { kind: 'events', steps }, text: answer, sources: srcs, proposals };
}

export { formatDay };
