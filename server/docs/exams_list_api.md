# Exams List API

考試資料列表使用 `GET`，因為它只讀取資料，不改變資料庫。

## API

```text
GET /api/exams
```

## Query Parameters

| 參數 | 說明 | 預設 |
| --- | --- | --- |
| `page` | 第幾頁，從 1 開始 | `1` |
| `per_page` | 每頁筆數，最大 100 | `20` |
| `sort` | `roc_desc`、`roc_asc`、`name_asc` | `roc_desc` |
| `q` | 關鍵字，搜尋組合後的考試名稱 | 空 |

## Example

```text
GET /api/exams?page=1&per_page=20&sort=roc_desc&q=中興
```

## SQL Flow

```text
1. WHERE deleted_at IS NULL
2. 如果有 q，使用 CONCAT_WS 搜尋顯示名稱
3. SELECT COUNT(*) 取得總筆數
4. SELECT exams rows with LIMIT/OFFSET
5. 回傳 data 與 meta
```

## Success Response

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "source": "https://example.edu.tw/exams/108.pdf",
      "roc_year": 108,
      "university": "中興",
      "department": "精密",
      "division": null,
      "subject": "工程數學",
      "paper": null
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 1,
    "total_pages": 1
  }
}
```

## Failure Response

```json
{
  "success": false,
  "message": "Failed to fetch exams"
}
```

## Timeout

前端等待 API 回應 60 秒。後端資料庫查詢超過 55 秒會中斷 connection 並回傳 `504`。

考量目前開發環境是低規格電腦、XAMPP MySQL、Next.js dev server，60 秒雖然比正式網站長，但可以避免本機開發時過早誤判逾時。

若 1500 筆 exams 仍經常超過 60 秒，通常不是資料量問題，而應檢查：

- XAMPP MySQL 是否正常執行
- MySQL 帳號密碼或資料庫連線是否卡住
- `exams.deleted_at`、`exams.roc_year` 索引是否存在
- 電腦記憶體是否不足
- 專案是否放在 OneDrive 同步路徑導致 dev server 反應變慢
