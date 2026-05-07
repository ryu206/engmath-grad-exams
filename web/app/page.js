const pages = [
  { href: '/prototype/exams-list.html', label: '前台考試列表' },
  { href: '/prototype/exam-questions.html?exam_id=1', label: '前台題目列表' },
  { href: '/prototype/exams.html', label: '新增考試資料' },
  { href: '/prototype/questions.html?exam_id=1', label: '新增題目' },
  { href: '/prototype/independent-question-create.html', label: '新增獨立題目' },
  { href: '/prototype/independent-questions.html', label: '獨立題目列表' },
  { href: '/prototype/answers.html?question_id=101', label: '新增解答' },
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Engineering Math Bank</p>
        <h1>工程數學題庫系統</h1>
        <p className="lead">
          Next.js App Router 已建立完成。現在可以逐步把既有 HTML prototype 拆成前台、後台頁面與 API route。
        </p>
      </section>

      <section className="panel">
        <h2>目前可查看的 prototype</h2>
        <div className="link-grid">
          {pages.map((page) => (
            <a href={page.href} key={page.href}>
              {page.label}
            </a>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>API 測試</h2>
        <p>
          後端 route handler 測試：
          <a className="inline-link" href="/api/health">
            /api/health
          </a>
        </p>
      </section>
    </main>
  );
}
