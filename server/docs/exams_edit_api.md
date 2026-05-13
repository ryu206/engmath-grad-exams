# Edit Exam API

編輯考試資料涉及讀取、更新與軟刪除。

## Page

Prototype:

```text
GET /prototype/edit-exams.html?id=1
```

正式路由建議：

```text
GET /admin/exams/{exam}/edit
```

## APIs

```text
GET    /api/admin/exams/{id}
PATCH  /api/admin/exams/{id}
DELETE /api/admin/exams/{id}
```

## GET Flow

```text
1. 驗證 id
2. 查詢 exams
3. 條件：id = ? AND deleted_at IS NULL
4. 回傳考試資料
```

## PATCH Flow

```text
1. 驗證 id
2. 解析 JSON
3. 驗證欄位
4. beginTransaction
5. UPDATE exams
6. 條件：id = ? AND deleted_at IS NULL
7. commit
8. 回傳 redirect_to
```

Request:

```json
{
  "exams": {
    "id": 1,
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

Success:

```json
{
  "success": true,
  "message": "Exam updated",
  "data": {
    "id": 1,
    "redirect_to": "/prototype/edit-exams.html?id=1"
  }
}
```

前端成功後：

```text
1. alert 已成功更新
2. 重新導向編輯頁
```

## DELETE Flow

```text
1. 前端先 confirm
2. DELETE /api/admin/exams/{id}
3. beginTransaction
4. UPDATE exams SET deleted_at = CURRENT_TIMESTAMP
5. 條件：id = ? AND deleted_at IS NULL
6. commit
7. 回傳列表頁 redirect_to
```

Success:

```json
{
  "success": true,
  "message": "Exam deleted",
  "data": {
    "id": 1,
    "redirect_to": "/prototype/exams-list.html"
  }
}
```

前端成功後：

```text
1. alert 已刪除成功
2. 跳轉考試資料列表
```

## Timeout

後端資料庫操作超過 55 秒會 destroy connection。前端等待後端回應 60 秒。

在低規格硬體或 XAMPP/MySQL 反應慢的環境中，前端 timeout 不應直接視為「一定寫入失敗」。若前端顯示等待逾時，使用者應重新整理或回列表確認資料是否已更新，再決定是否重送。

HTTP status:

```text
504
```

## Failure Handling

- `400`: id 或 JSON 格式錯誤
- `404`: exams 找不到或已被 soft delete
- `422`: 欄位驗證失敗
- `500`: 資料庫或未知錯誤
- `504`: 操作逾時
