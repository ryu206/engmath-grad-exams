# Server Flow Design

本系統預計分為前台與後台：

- 前台只讀取資料，不做新增、修改、刪除。
- 後台才提供新增、修改、刪除、上傳圖片。

目前本機環境是 XAMPP MySQL，因此 server 端可先用 PHP + PDO 實作。之後若換 Laravel 或其他框架，流程仍可沿用。

## 1. 前端送資料方式

### 沒有圖片時

沒有圖片的表單可以用 JSON：

```js
fetch('/admin/api/exams', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});
```

適合：

- 新增考試 `exams`
- 編輯考試 `exams`
- 沒有圖片的題目或解答

### 有圖片時

有圖片時用 `FormData`：

```js
const formData = new FormData();
formData.append('payload', JSON.stringify(payload));
formData.append('question_image', questionImageFile);

fetch('/admin/api/questions', {
  method: 'POST',
  body: formData
});
```

適合：

- 新增題目並上傳題目圖片
- 新增子題圖片
- 新增解答圖片
- 編輯時替換圖片

重點：文字資料仍放在 `payload` JSON，圖片檔案另外 append。

## 2. 建議 API 路由

### 後台寫入 API

```text
POST   /admin/api/exams
PATCH  /admin/api/exams/{id}
DELETE /admin/api/exams/{id}

POST   /admin/api/questions
PATCH  /admin/api/questions/{id}
DELETE /admin/api/questions/{id}

POST   /admin/api/answers
PATCH  /admin/api/answers/{id}
DELETE /admin/api/answers/{id}

POST   /admin/api/attachments
DELETE /admin/api/attachments/{id}
```

### 前台讀取 API

```text
GET /api/exams?page=1&per_page=20
GET /api/exams/{id}/questions
GET /api/questions/{id}
GET /api/questions/{id}/answer
GET /api/search?q=keyword
```

## 3. Server 端基本目錄建議

```text
/api
  /admin
    exams.php
    questions.php
    answers.php
  db.php
  helpers.php

/public
  /uploads
    /questions
    /subquestions
    /answers
```

若先用純 PHP，可以用不同 PHP 檔案處理不同 API。若之後使用框架，再改成 controller。

## 4. PDO 連線

`api/db.php`

```php
<?php

function db(): PDO
{
    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '3306';
    $dbname = getenv('DB_NAME');
    $username = getenv('DB_USER');
    $password = getenv('DB_PASSWORD');

    if (!$dbname || !$username || !$password) {
        throw new RuntimeException('Missing database environment variables.');
    }

    $dsn = "mysql:host={$host};port={$port};dbname={$dbname};charset=utf8mb4";

    return new PDO($dsn, $username, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}
```

## 5. 接收 JSON Payload

```php
<?php

function readJsonPayload(): array
{
    $raw = file_get_contents('php://input');
    $payload = json_decode($raw, true);

    if (!is_array($payload)) {
        http_response_code(400);
        echo json_encode(['message' => 'Invalid JSON payload']);
        exit;
    }

    return $payload;
}
```

## 6. 接收 FormData Payload

```php
<?php

function readMultipartPayload(): array
{
    $payload = json_decode($_POST['payload'] ?? '', true);

    if (!is_array($payload)) {
        http_response_code(400);
        echo json_encode(['message' => 'Invalid multipart payload']);
        exit;
    }

    return $payload;
}
```

## 7. 新增考試資料流程

前端送：

```json
{
  "exams": {
    "roc_year": 108,
    "university": "中興",
    "department": "精密",
    "division": null,
    "subject": "工程數學",
    "paper": null
  }
}
```

後端：

```php
$pdo = db();
$payload = readJsonPayload();
$exam = $payload['exams'];

$stmt = $pdo->prepare("
    INSERT INTO exams (
        roc_year,
        university,
        department,
        division,
        subject,
        paper
    ) VALUES (
        :roc_year,
        :university,
        :department,
        :division,
        :subject,
        :paper
    )
");

$stmt->execute([
    ':roc_year' => $exam['roc_year'] ?? null,
    ':university' => $exam['university'] ?? null,
    ':department' => $exam['department'] ?? null,
    ':division' => $exam['division'] ?? null,
    ':subject' => $exam['subject'] ?? null,
    ':paper' => $exam['paper'] ?? null,
]);

echo json_encode([
    'id' => (int) $pdo->lastInsertId()
]);
```

`created_at` 和 `updated_at` 由 MySQL 自動產生，不需要前端送。

## 8. 新增題目資料流程

題目可能同時寫入：

- `questions`
- `choices`
- `subquestions`
- `subchoices`
- `attachments`

所以必須使用 transaction。

流程：

```text
1. beginTransaction
2. insert questions
3. 取得 question_id
4. 如果有 choices，insert choices.question_id = question_id
5. 如果有 subquestions，逐筆 insert subquestions.main_question = question_id
6. 每一筆子題 insert 後，取得 subquestion_id
7. 如果該子題有 subchoices，insert subchoices.subquestion_id = subquestion_id
8. 如果有圖片，先存檔，再 insert attachments
9. commit
10. 任一失敗 rollback，並刪除已存檔但未成功關聯的圖片
```

簡化範例：

```php
$pdo = db();
$payload = isset($_POST['payload'])
    ? readMultipartPayload()
    : readJsonPayload();

$uploadedFiles = [];

try {
    $pdo->beginTransaction();

    $question = $payload['questions'];

    $stmt = $pdo->prepare("
        INSERT INTO questions (
            question_number,
            question_text,
            exam_id,
            score,
            question_type,
            difficulty,
            source,
            note
        ) VALUES (
            :question_number,
            :question_text,
            :exam_id,
            :score,
            :question_type,
            :difficulty,
            :source,
            :note
        )
    ");

    $stmt->execute([
        ':question_number' => $question['question_number'],
        ':question_text' => $question['question_text'] ?? null,
        ':exam_id' => $question['exam_id'] ?? null,
        ':score' => $question['score'] ?? null,
        ':question_type' => $question['question_type'] ?? null,
        ':difficulty' => $question['difficulty'] ?? null,
        ':source' => $question['source'] ?? null,
        ':note' => $question['note'] ?? null,
    ]);

    $questionId = (int) $pdo->lastInsertId();

    if (!empty($payload['choices'])) {
        insertChoices($pdo, $questionId, $payload['choices']);
    }

    $clientSubquestionMap = [];

    foreach ($payload['subquestions'] ?? [] as $subquestion) {
        $subquestionId = insertSubquestion($pdo, $questionId, $subquestion);

        if (!empty($subquestion['_client_key'])) {
            $clientSubquestionMap[$subquestion['_client_key']] = $subquestionId;
        }
    }

    foreach ($payload['subchoices'] ?? [] as $subchoice) {
        $clientKey = $subchoice['_parent_subquestion_client_key'] ?? null;
        $subquestionId = $clientSubquestionMap[$clientKey] ?? null;

        if (!$subquestionId) {
            throw new RuntimeException('Missing subquestion id for subchoices');
        }

        insertSubchoices($pdo, $subquestionId, $subchoice);
    }

    // 圖片處理：實作時依欄位名稱對應 question / subquestion / answer
    // 存檔後 insert attachments。

    $pdo->commit();

    echo json_encode([
        'question_id' => $questionId
    ]);
} catch (Throwable $e) {
    $pdo->rollBack();

    foreach ($uploadedFiles as $path) {
        if (is_file($path)) {
            unlink($path);
        }
    }

    http_response_code(500);
    echo json_encode([
        'message' => 'Failed to create question',
        'error' => $e->getMessage()
    ]);
}
```

## 9. choices 寫入

```php
function insertChoices(PDO $pdo, int $questionId, array $choices): void
{
    $stmt = $pdo->prepare("
        INSERT INTO choices (
            question_id, A, B, C, D, E, F, G, H
        ) VALUES (
            :question_id, :A, :B, :C, :D, :E, :F, :G, :H
        )
    ");

    $stmt->execute([
        ':question_id' => $questionId,
        ':A' => $choices['A'] ?? null,
        ':B' => $choices['B'] ?? null,
        ':C' => $choices['C'] ?? null,
        ':D' => $choices['D'] ?? null,
        ':E' => $choices['E'] ?? null,
        ':F' => $choices['F'] ?? null,
        ':G' => $choices['G'] ?? null,
        ':H' => $choices['H'] ?? null,
    ]);
}
```

## 10. subquestions 寫入

```php
function insertSubquestion(PDO $pdo, int $questionId, array $subquestion): int
{
    $stmt = $pdo->prepare("
        INSERT INTO subquestions (
            subquestion_number,
            subquestion_text,
            main_question,
            score,
            question_type
        ) VALUES (
            :subquestion_number,
            :subquestion_text,
            :main_question,
            :score,
            :question_type
        )
    ");

    $stmt->execute([
        ':subquestion_number' => $subquestion['subquestion_number'],
        ':subquestion_text' => $subquestion['subquestion_text'] ?? null,
        ':main_question' => $questionId,
        ':score' => $subquestion['score'] ?? null,
        ':question_type' => $subquestion['question_type'] ?? null,
    ]);

    return (int) $pdo->lastInsertId();
}
```

## 11. subchoices 寫入

```php
function insertSubchoices(PDO $pdo, int $subquestionId, array $subchoice): void
{
    $stmt = $pdo->prepare("
        INSERT INTO subchoices (
            subquestion_id, A, B, C, D, E, F, G, H
        ) VALUES (
            :subquestion_id, :A, :B, :C, :D, :E, :F, :G, :H
        )
    ");

    $stmt->execute([
        ':subquestion_id' => $subquestionId,
        ':A' => $subchoice['A'] ?? null,
        ':B' => $subchoice['B'] ?? null,
        ':C' => $subchoice['C'] ?? null,
        ':D' => $subchoice['D'] ?? null,
        ':E' => $subchoice['E'] ?? null,
        ':F' => $subchoice['F'] ?? null,
        ':G' => $subchoice['G'] ?? null,
        ':H' => $subchoice['H'] ?? null,
    ]);
}
```

## 12. answers 寫入

一個 `questions.id` 對應一筆 active answer。

流程：

```text
1. 確認 questions.id 存在
2. 檢查該 question_id 是否已有 active answer
3. insert answers
4. 若有圖片，存檔後 insert attachments.owner_type = answer
```

```php
$stmt = $pdo->prepare("
    INSERT INTO answers (
        short_answer,
        answer_text,
        question_id,
        source,
        note
    ) VALUES (
        :short_answer,
        :answer_text,
        :question_id,
        :source,
        :note
    )
");

$stmt->execute([
    ':short_answer' => $answer['short_answer'] ?? null,
    ':answer_text' => $answer['answer_text'] ?? null,
    ':question_id' => $answer['question_id'],
    ':source' => $answer['source'] ?? null,
    ':note' => $answer['note'] ?? null,
]);
```

## 13. 圖片處理

建議實體存放：

```text
public/uploads/{owner_type}/{yyyy}/{mm}/{owner_id}/{uuid}.{ext}
```

例如：

```text
public/uploads/questions/2026/05/101/uuid.png
public/uploads/subquestions/2026/05/401/uuid.jpg
public/uploads/answers/2026/05/701/uuid.webp
```

DB 存：

```text
attachments.path = uploads/questions/2026/05/101/uuid.png
```

簡化存檔：

```php
function storeUploadedImage(array $file, string $ownerType, int $ownerId): array
{
    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Upload failed');
    }

    $allowed = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    $mime = mime_content_type($file['tmp_name']);

    if (!isset($allowed[$mime])) {
        throw new RuntimeException('Unsupported image type');
    }

    $extension = $allowed[$mime];
    $storedFilename = bin2hex(random_bytes(16)) . '.' . $extension;
    $year = gmdate('Y');
    $month = gmdate('m');

    $relativeDir = "uploads/{$ownerType}/{$year}/{$month}/{$ownerId}";
    $absoluteDir = __DIR__ . "/../public/{$relativeDir}";

    if (!is_dir($absoluteDir)) {
        mkdir($absoluteDir, 0775, true);
    }

    $absolutePath = "{$absoluteDir}/{$storedFilename}";
    $relativePath = "{$relativeDir}/{$storedFilename}";

    if (!move_uploaded_file($file['tmp_name'], $absolutePath)) {
        throw new RuntimeException('Failed to move uploaded file');
    }

    [$width, $height] = getimagesize($absolutePath) ?: [null, null];

    return [
        'absolute_path' => $absolutePath,
        'path' => $relativePath,
        'stored_filename' => $storedFilename,
        'original_filename' => $file['name'],
        'mime_type' => $mime,
        'file_size' => filesize($absolutePath),
        'extension' => $extension,
        'width' => $width,
        'height' => $height,
        'checksum' => hash_file('sha256', $absolutePath),
    ];
}
```

## 14. attachments 寫入

```php
function insertAttachment(PDO $pdo, int $ownerId, string $ownerType, string $usageType, array $stored): void
{
    $stmt = $pdo->prepare("
        INSERT INTO attachments (
            owner_type,
            owner_id,
            usage_type,
            disk,
            path,
            url,
            original_filename,
            stored_filename,
            mime_type,
            file_size,
            extension,
            width,
            height,
            checksum,
            display_order,
            alt_text,
            metadata
        ) VALUES (
            :owner_type,
            :owner_id,
            :usage_type,
            'local',
            :path,
            NULL,
            :original_filename,
            :stored_filename,
            :mime_type,
            :file_size,
            :extension,
            :width,
            :height,
            :checksum,
            1,
            NULL,
            NULL
        )
    ");

    $stmt->execute([
        ':owner_type' => $ownerType,
        ':owner_id' => $ownerId,
        ':usage_type' => $usageType,
        ':path' => $stored['path'],
        ':original_filename' => $stored['original_filename'],
        ':stored_filename' => $stored['stored_filename'],
        ':mime_type' => $stored['mime_type'],
        ':file_size' => $stored['file_size'],
        ':extension' => $stored['extension'],
        ':width' => $stored['width'],
        ':height' => $stored['height'],
        ':checksum' => $stored['checksum'],
    ]);
}
```

## 15. 編輯資料流程

編輯題目或解答時，不建議整筆刪掉重建，而是：

```text
1. update 主表
2. update / insert / soft delete 子資料
3. 圖片 replace 時：
   - 先上傳新圖片
   - update 或 insert 新 attachments
   - soft delete 舊 attachments
   - 成功後可刪除舊實體檔，或保留備份
```

## 16. 刪除流程

全部使用 soft delete：

```sql
UPDATE questions
SET deleted_at = CURRENT_TIMESTAMP
WHERE id = :id;
```

後台可依需求一併 soft delete 關聯資料：

```text
questions
choices
subquestions
subchoices
answers
attachments
```

前台查詢一律加：

```sql
deleted_at IS NULL
```

## 17. 回應格式

成功：

```json
{
  "success": true,
  "data": {
    "id": 101
  }
}
```

失敗：

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "question_number": "題號必填"
  }
}
```

## 18. 必要安全檢查

後台 API 必須檢查：

- 是否登入
- 是否有管理權限
- CSRF token
- 檔案 mime type
- 檔案大小
- 副檔名
- 不信任前端傳來的 `created_at`、`updated_at`
- 所有 SQL 使用 prepared statement
- 圖片不能讓使用者指定儲存檔名
