# Create Question API

新增題目使用 `POST`，因為會建立 questions、choices、subquestions、subchoices、attachments。

## Pages

```text
GET /prototype/exam-questions.html?exam_id=3
GET /prototype/questions.html?exam_id=3
```

`questions.html` 會從 route query 的 `exam_id` 讀取考試資料，顯示考試名稱，但不允許使用者更改。送出時仍傳數字 `exam_id` 給後端，寫入 `questions.exam_id`。

## APIs

```text
GET  /api/exams/{exam}/questions
POST /api/admin/questions
```

## Required Fields

主題目：

```text
exam_id
question_number
question_type
score
question_text or question_image or at least one subquestion
```

主題目若是 `single_choice` 或 `multiple_choice`：

```text
choices 至少填 A、B
```

子題：

```text
subquestion_number
question_type
score
subquestion_text or subquestion_image
```

子題若是 `single_choice` 或 `multiple_choice`：

```text
subchoices 至少填 A、B
```

## Image Rules

```text
max size: 1MB
allowed: image/jpeg, image/png, image/webp
options cannot upload images
```

## Supported Cases

目前流程已涵蓋：

```text
1. 計算題
2. 選擇題及其選項
3. 有圖片的計算題
4. 有圖片的選擇題及其選項
5. 題組，有兩個子題
6. 題組，有兩個子題，子題有選擇題選項
7. 題組，主題目有圖片，有兩個子題
8. 題組，主題目有圖片，有兩個子題，子題有選擇題選項
9. 題組，主題目有圖片，有兩個子題，子題目有圖片
10. 題組，主題目有圖片，有兩個子題，子題目有圖片，有選擇題選項
```

另外也建議未來補充測試：

```text
- 題組主題目沒有文字但有圖片
- 題組主題目有文字但沒有圖片
- 子題只有圖片沒有文字
- 子題只有文字沒有圖片
- 主題目為是非題
- 子題為是非題
- 選擇題只有 A、B
- 選擇題有 A-H
- 圖片格式錯誤
- 圖片超過 1MB
```

## Server Flow

```text
1. 接收 multipart/form-data
2. payload 欄位解析 JSON
3. question_image 接主題目圖片
4. subquestion_image__{client_key} 接子題圖片
5. 驗證必填欄位與圖片格式/大小
6. beginTransaction
7. insert questions
8. 若主題目為選擇題，insert choices
9. 若主題目有圖片，存檔後 insert attachments(owner_type = question)
10. insert subquestions，並建立 client_key -> subquestions.id 對照
11. 若子題有圖片，存檔後 insert attachments(owner_type = subquestion)
12. 若子題有選項，insert subchoices
13. commit
14. 任一步失敗 rollback，並刪除已存到硬碟但尚未成功關聯的圖片
```

## Timeout

前端等待 120 秒。後端題目建立交易 timeout 為 115 秒。

因為新增題目可能包含多張圖片，且目前開發環境是低規格電腦與 XAMPP MySQL，這裡比 exams 的文字寫入保守一些。每張圖片仍限制 1MB，因此 120 秒已足夠寬鬆；若仍經常逾時，通常要檢查 MySQL、磁碟、OneDrive 同步或 Next dev server 是否卡住。

正式環境可再依伺服器性能降低 timeout。
