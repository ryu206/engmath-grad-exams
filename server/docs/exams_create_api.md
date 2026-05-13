# Create Exam API

新增考試資料是建立資料，應使用 `POST`，不是 `GET`。

## Page

Prototype:

```text
GET /prototype/exams.html
```

正式路由建議：

```text
GET /admin/exams/create
```

## API

```text
POST /api/admin/exams
```

## Request

前端用 JSON 送出：

```json
{
  "exams": {
    "id": null,
    "source": "https://example.edu.tw/exams/108.pdf",
    "roc_year": 108,
    "university": "中興",
    "department": "精密",
    "division": null,
    "subject": "工程數學",
    "paper": null
  }
}
```

`created_at`、`updated_at` 不需要前端送，由 MySQL 自動處理。

`source` 非必填，空字串會存為 `NULL`，最多 2048 字元，適合存放較長的來源網址。

`roc_year` 驗證範圍為 1 到 9999，允許四位數年份。

## Server Flow

```text
1. 解析 JSON
2. 驗證欄位
3. 取得 MySQL connection
4. beginTransaction
5. insert exams
6. commit
7. 回傳新建立的 exams.id 與 redirect_to
```

## Success Response

```json
{
  "success": true,
  "message": "Exam created",
  "data": {
    "id": 12,
    "redirect_to": "/prototype/exams-list.html"
  }
}
```

前端收到成功後：

```text
1. 顯示新增成功
2. 轉跳 /prototype/exams-list.html
```

## Validation Failed

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "roc_year": "考試年分需為 1 到 999 的整數"
  }
}
```

HTTP status:

```text
422
```

## Timeout

後端資料庫操作超過 55 秒會中斷 connection。前端等待後端回應 60 秒。

在低規格硬體或 XAMPP/MySQL 反應慢的環境中，前端 timeout 不應直接視為「一定寫入失敗」。若前端顯示等待逾時，使用者應先回列表確認資料是否已存在，再決定是否重送。

HTTP status:

```text
504
```

Response:

```json
{
  "success": false,
  "message": "Request timeout. Please try again later."
}
```

## Failure

寫入失敗會 rollback transaction。

HTTP status:

```text
500
```

Response:

```json
{
  "success": false,
  "message": "Failed to create exam"
}
```
