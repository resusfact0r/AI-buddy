import type { AccessStatus, Article, Role, TaskStatus } from '@/api/schemas';

/** Исходные демо-данные моков. Всё тестовое. */

export interface MockUser {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  team_id: string | null;
  position: string;
  contact: string;
}

export const USERS: MockUser[] = [
  {
    id: 'u-anna',
    username: 'intern_anna',
    display_name: 'Анна Смирнова',
    role: 'intern',
    team_id: 't-delivery',
    position: 'Стажёр-разработчик Go',
    contact: '@intern_anna',
  },
  {
    id: 'u-boris',
    username: 'intern_boris',
    display_name: 'Борис Кузнецов',
    role: 'intern',
    team_id: 't-delivery',
    position: 'Стажёр-аналитик',
    contact: '@intern_boris',
  },
  {
    id: 'u-vera',
    username: 'intern_vera',
    display_name: 'Вера Орлова',
    role: 'intern',
    team_id: 't-ads-front',
    position: 'Стажёр-фронтенд',
    contact: '@intern_vera',
  },
  {
    id: 'u-dmitry',
    username: 'buddy_dmitry',
    display_name: 'Дмитрий Волков',
    role: 'buddy',
    team_id: 't-delivery',
    position: 'Senior Go-разработчик, наставник',
    contact: '@buddy_dmitry',
  },
  {
    id: 'u-elena',
    username: 'lead_elena',
    display_name: 'Елена Морозова',
    role: 'lead',
    team_id: 't-delivery',
    position: 'Руководитель команды «Доставка»',
    contact: '@lead_elena',
  },
  {
    id: 'u-fedor',
    username: 'lead_fedor',
    display_name: 'Фёдор Лебедев',
    role: 'lead',
    team_id: 't-ads-front',
    position: 'Руководитель «Фронтенд Объявлений»',
    contact: '@lead_fedor',
  },
];

export const PASSWORD = 'test1234';

export interface MockTeam {
  id: string;
  name: string;
  description: string;
  lead_id: string;
  buddy_by_intern: Record<string, string | null>;
}

export const TEAMS: MockTeam[] = [
  {
    id: 't-delivery',
    name: 'Доставка',
    description:
      'Сервисы доставки товаров между пользователями: расчёт стоимости, трекинг, интеграции с перевозчиками.',
    lead_id: 'u-elena',
    buddy_by_intern: { 'u-anna': 'u-dmitry', 'u-boris': 'u-dmitry' },
  },
  {
    id: 't-ads-front',
    name: 'Фронтенд Объявлений',
    description: 'Карточка объявления, форма подачи и поиск — всё, что видит пользователь на вебе.',
    lead_id: 'u-fedor',
    buddy_by_intern: { 'u-vera': null },
  },
];

export const START_DATES: Record<string, string> = {
  'u-anna': '2026-11-02',
  'u-boris': '2026-11-02',
  'u-vera': '2026-10-26',
};

export interface TaskTemplate {
  id: string;
  code?: string;
  title: string;
  description: string;
  required: boolean;
  auto_complete?: boolean;
}

export interface StageTemplate {
  id: string;
  title: string;
  description: string;
  tasks: TaskTemplate[];
}

export const PLAN_TEMPLATE: StageTemplate[] = [
  {
    id: 'st-day1',
    title: 'Первый день',
    description: 'Оформление и знакомство',
    tasks: [
      {
        id: 'docs',
        title: 'Подписать документы в кадровом портале',
        description: 'Трудовой договор и NDA.',
        required: true,
      },
      {
        id: 'laptop',
        title: 'Получить и настроить ноутбук',
        description: 'Выдаёт служба поддержки на 3 этаже.',
        required: true,
      },
      {
        id: 'meet-buddy',
        title: 'Познакомиться с наставником',
        description: 'Короткая встреча на 30 минут.',
        required: true,
      },
    ],
  },
  {
    id: 'st-week1',
    title: 'Первая неделя',
    description: 'Доступы, окружение, процессы команды',
    tasks: [
      {
        id: 'get-access',
        code: 'get_access',
        title: 'Получить доступы',
        description: 'Все обязательные системы из списка «Мои доступы».',
        required: true,
        auto_complete: true,
      },
      {
        id: 'dev-env',
        title: 'Развернуть проект локально',
        description: 'По инструкции в README сервиса команды.',
        required: true,
      },
      {
        id: 'read-review',
        title: 'Прочитать гайд по код-ревью',
        description: 'Правила ревью в вашей команде.',
        required: true,
      },
      {
        id: 'team-lunch',
        title: 'Сходить на обед с командой',
        description: 'Необязательно, но очень полезно.',
        required: false,
      },
    ],
  },
  {
    id: 'st-month1',
    title: 'Первый месяц',
    description: 'Первая задача и погружение',
    tasks: [
      {
        id: 'first-task',
        title: 'Довести первую задачу до прода',
        description: 'Небольшая задача из бэклога с меткой good-first-task.',
        required: true,
      },
      {
        id: 'security',
        title: 'Пройти курс по информационной безопасности',
        description: 'Курс в учебном портале, ~1 час.',
        required: true,
      },
      {
        id: 'one-on-one',
        title: 'Встреча 1:1 с руководителем',
        description: 'Обсудить ожидания и цели.',
        required: false,
      },
    ],
  },
  {
    id: 'st-probation',
    title: 'Итоги стажировки',
    description: 'Демо и обратная связь',
    tasks: [
      { id: 'demo', title: 'Показать демо своей работы', description: 'На встрече команды.', required: true },
      {
        id: 'final',
        title: 'Итоговая встреча с руководителем',
        description: 'Обратная связь и следующие шаги.',
        required: true,
      },
    ],
  },
];

export const INITIAL_TASK_STATUS: Record<string, Record<string, TaskStatus>> = {
  'u-anna': { docs: 'done', laptop: 'done', 'meet-buddy': 'done', 'dev-env': 'in_progress' },
  'u-boris': { docs: 'done', laptop: 'done' },
  'u-vera': { docs: 'done', laptop: 'done', 'meet-buddy': 'done', 'dev-env': 'done', 'read-review': 'done' },
};

export interface SystemTemplate {
  id: string;
  name: string;
  purpose: string;
  required: boolean;
}

export const SYSTEMS_BY_TEAM: Record<string, SystemTemplate[]> = {
  't-delivery': [
    {
      id: 'sys-mm',
      name: 'Корпоративный мессенджер',
      purpose: 'Общение с командой и наставником',
      required: true,
    },
    { id: 'sys-gitlab', name: 'GitLab', purpose: 'Код сервисов доставки, merge request’ы', required: true },
    { id: 'sys-jira', name: 'Jira', purpose: 'Задачи и спринты команды', required: true },
    { id: 'sys-grafana', name: 'Grafana', purpose: 'Метрики и дашборды сервисов', required: false },
  ],
  't-ads-front': [
    { id: 'sys-mm', name: 'Корпоративный мессенджер', purpose: 'Общение с командой', required: true },
    { id: 'sys-gitlab', name: 'GitLab', purpose: 'Код фронтенда объявлений', required: true },
    { id: 'sys-figma', name: 'Figma', purpose: 'Макеты дизайнеров', required: true },
    { id: 'sys-sentry', name: 'Sentry', purpose: 'Ошибки на клиенте', required: false },
  ],
};

export const INITIAL_ACCESS: Record<string, Record<string, AccessStatus>> = {
  'u-anna': { 'sys-mm': 'granted' },
  'u-boris': { 'sys-mm': 'granted', 'sys-gitlab': 'granted' },
  'u-vera': { 'sys-mm': 'granted', 'sys-gitlab': 'granted' },
};

const DEMO = '\n\n---\n*Демо-версия, тестовые данные.*';

export const ARTICLES: Article[] = [
  {
    id: 'kb-leave',
    title: 'Как оформить отгул (тест.)',
    team_id: null,
    updated_at: '2026-10-01T10:00:00Z',
    content_md:
      '# Как оформить отгул\n\n' +
      '1. **Предупредите руководителя** минимум за 2 рабочих дня. В срочных случаях — в день отгула, но до начала рабочего дня.\n' +
      '2. **Создайте заявку** в AI-buddy или вручную в разделе «Мои заявки». Укажите даты и, при желании, комментарий.\n' +
      '3. Заявку **согласует руководитель команды**. Статус виден в «Моих заявках».\n' +
      '4. Отгул не может длиться больше **14 дней подряд** — для этого оформляется отпуск.\n\n' +
      'Отгул на время стажировки не влияет на прохождение плана адаптации.' +
      DEMO,
  },
  {
    id: 'kb-review-delivery',
    title: 'Код-ревью в команде «Доставка» (тест.)',
    team_id: 't-delivery',
    updated_at: '2026-09-15T10:00:00Z',
    content_md:
      '# Код-ревью в «Доставке»\n\n' +
      '- Каждый MR смотрят **два ревьюера**: наставник и любой бэкендер команды.\n' +
      '- Размер MR — до **400 строк**, иначе разбивайте.\n' +
      '- Ревьюеров назначает бот в канале **#delivery-review**, SLA на первый ответ — **4 рабочих часа**.\n' +
      '- Линтер `golangci-lint` и тесты должны быть зелёными до ревью.' +
      DEMO,
  },
  {
    id: 'kb-review-ads',
    title: 'Код-ревью во «Фронтенде Объявлений» (тест.)',
    team_id: 't-ads-front',
    updated_at: '2026-09-20T10:00:00Z',
    content_md:
      '# Код-ревью во «Фронтенде Объявлений»\n\n' +
      '- Достаточно **одного аппрува** от участника команды, для изменений в дизайн-системе — ещё аппрув от дизайнера.\n' +
      '- К MR прикладывайте **скриншоты или ссылку на Storybook**.\n' +
      '- Ревью раздаётся по очереди в канале **#ads-front-review**, SLA — **1 рабочий день**.\n' +
      '- Обязательны зелёные `eslint`, `tsc` и визуальные тесты.' +
      DEMO,
  },
  {
    id: 'kb-access',
    title: 'Доступы для новичков (тест.)',
    team_id: null,
    updated_at: '2026-10-05T10:00:00Z',
    content_md:
      '# Доступы для новичков\n\n' +
      'Список систем зависит от команды. Запросить доступ можно в AI-buddy или на экране «Мои доступы».\n\n' +
      'Запрос согласует **руководитель команды**, после одобрения доступ выдаётся автоматически. ' +
      'Когда выданы все обязательные доступы, задача «Получить доступы» в плане адаптации закрывается сама.' +
      DEMO,
  },
  {
    id: 'kb-onboarding',
    title: 'План адаптации стажёра (тест.)',
    team_id: null,
    updated_at: '2026-10-05T10:00:00Z',
    content_md:
      '# План адаптации\n\n' +
      'Адаптация состоит из четырёх этапов: первый день, первая неделя, первый месяц и итоги стажировки. ' +
      'Обязательные задачи нужно закрыть до конца этапа, необязательные — по желанию.' +
      DEMO,
  },
];
