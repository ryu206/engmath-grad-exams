# Route Design

系統分為前台與後台：

- 前台：僅瀏覽、查詢，不提供新增、編輯、刪除。
- 後台：需要登入與權限檢查，才能進行新增、修改、刪除、上傳圖片等資料異動。

目前靜態 HTML prototype 放在 `web/public/prototype/`，可透過 `/prototype/*.html` 瀏覽。之後 Next.js 頁面會逐步取代 prototype，正式路由可沿用同一組語意設計。

## Frontstage Routes

| 功能 | Prototype 檔案 | 建議正式路由 |
| --- | --- | --- |
| 首頁 | `home.html` 或 `index.html` | `GET /` |
| 前台考試列表 | `/prototype/exams-list.html` | `GET /exams` |
| 前台某考試題目列表 | `/prototype/exam-questions.html?exam_id=1` | `GET /exams/{exam}/questions` |
| 前台題目詳細頁 | `/prototype/question-detail.html?id=101` | `GET /questions/{question}` |
| 前台查詢頁 | `search.html` | `GET /search` |
| 前台解答瀏覽 | `/prototype/answer-detail.html?question_id=101` | `GET /questions/{question}/answer` |

## Admin Routes

| 功能 | Prototype 檔案 | 建議正式路由 |
| --- | --- | --- |
| 後台首頁 | `admin-dashboard.html` | `GET /admin` |
| 後台考試列表 | `/prototype/exams-list.html` admin mode | `GET /admin/exams` |
| 新增考試 | `/prototype/exams.html` | `GET /admin/exams/create` |
| 編輯考試 | `/prototype/edit-exams.html?id=1` | `GET /admin/exams/{exam}/edit` |
| 後台某考試題目列表 | `/prototype/exam-questions.html?exam_id=1` admin mode | `GET /admin/exams/{exam}/questions` |
| 新增題目 | `/prototype/questions.html?exam_id=1` | `GET /admin/questions/create` |
| 編輯題目 | `/prototype/edit-question.html?id=101` | `GET /admin/questions/{question}/edit` |
| 新增解答 | `/prototype/answers.html?question_id=101` | `GET /admin/questions/{question}/answers/create` |
| 修改解答 | `/prototype/edit-answer.html?id=501` | `GET /admin/answers/{answer}/edit` |
| 考試刪除 | form action or API | `DELETE /admin/exams/{exam}` |
| 題目刪除 | form action or API | `DELETE /admin/questions/{question}` |
| 解答刪除 | form action or API | `DELETE /admin/answers/{answer}` |

## Future Pages

| 功能 | Prototype 檔案建議 | 建議正式路由 |
| --- | --- | --- |
| 後台登入 | `admin-login.html` | `GET /admin/login` |
| 後台使用者管理 | `admin-users.html` | `GET /admin/users` |

## Data Loading Rules

- `GET /exams`
  - 查詢 `exams`
  - 排除 `deleted_at IS NOT NULL`
  - 連結文字由 `roc_year + university + department + division + subject + paper` 組成
  - 欄位為空就不顯示

- `GET /exams/{exam}/questions`
  - 查詢 `questions.exam_id = exams.id`
  - 排除軟刪除資料
  - 依 `question_number` 自然排序：`1, 2, 3a, 10, a, b`
  - 一併載入 `subquestions.main_question = questions.id`
  - 子題也排除軟刪除資料

- `GET /questions/{question}`
  - 載入 `questions`
  - 載入 `choices`
  - 載入 `subquestions`
  - 載入 `subchoices`
  - 載入 `attachments`

## Notes

- 若考試名稱會被題目頁頻繁使用，建議後端統一提供 `exam_display_name` accessor/helper。
- `question_number` 若要完整支援自然排序，建議後端新增排序用欄位，例如 `sort_order`，避免純字串排序出現 `1, 10, 2`。
- 解答功能建議使用獨立資料表，例如 `answers`、`subanswers`，圖片沿用 `attachments`。
- 所有 `POST / PUT / PATCH / DELETE` 都應只存在後台路由，並加上登入、CSRF、防止越權修改的檢查。
- 前台頁面不顯示新增、編輯、刪除按鈕；若同一個 HTML prototype 暫時共用，正式實作時也應依權限隱藏或拆成獨立後台頁。
