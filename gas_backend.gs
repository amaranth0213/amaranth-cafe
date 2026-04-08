// ============================================================
//  あまらんす カフェ予約システム - Google Apps Script バックエンド
// ============================================================
//
// 【設定手順】
//  1. このファイルの内容を Google Apps Script に貼り付ける
//  2. 下の NOTIFY_EMAIL を自分の Gmail アドレスに書き換える
//  3. 「デプロイ」→「新しいデプロイ」→ 種類: ウェブアプリ
//     ・次のユーザーとして実行: 自分
//     ・アクセスできるユーザー: 全員
//  4. 発行された URL を HTML の GAS_URL に貼り付ける
// ============================================================

// ▼ ここを自分の Gmail アドレスに変更してください
const NOTIFY_EMAIL = 'あなたのGmailアドレス@gmail.com';

// スプレッドシートのシート名
const SHEET_NAME = '予約一覧';

// ============================================================
// POST リクエスト処理（予約受付）
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'reserve';

    if (action === 'reserve') {
      return handleReservation(data);
    }

    return jsonResponse({ success: false, error: '不明なアクション' });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ============================================================
// GET リクエスト処理（予約済みスロット取得）
// ============================================================
function doGet(e) {
  try {
    const sheet = getSheet();
    const rows = sheet.getDataRange().getValues();
    const slots = [];
    const menuCounts = {}; // { menuId: { 'YYYY-MM-DD': count } }

    // 1行目はヘッダーなのでスキップ
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[0]) {
        // 列構成: 0=日付, 1=時間, 2=席ID, 3=席名, 4=名前, 5=電話, 6=人数, 7=種別, 8=メニューJSON, 9=登録日時
        let menuOrders = {};
        try { menuOrders = JSON.parse(String(row[8])||'{}'); } catch(e) {}

        slots.push({
          date:      formatDateStr(row[0]),
          time:      formatTimeStr(row[1]),
          seat:      String(row[2]),
          seatLabel: String(row[3]||''),
          name:      String(row[4]||''),
          phone:     String(row[5]||''),
          people:    String(row[6]||''),
          isHold:    String(row[7]||'') === '確保枠',
          menuOrders: menuOrders,
        });

        // メニュー注文数を集計
        const date = formatDateStr(row[0]);
        Object.entries(menuOrders).forEach(([id, qty]) => {
          const q = Number(qty) || 0;
          if (q > 0) {
            if (!menuCounts[id]) menuCounts[id] = {};
            menuCounts[id][date] = (menuCounts[id][date] || 0) + q;
          }
        });
      }
    }

    return jsonResponse({ success: true, slots, menuCounts });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ============================================================
// 予約処理
// ============================================================
function handleReservation(data) {
  const sheet = getSheet();

  // 重複チェック（同日・同時間帯・同席）
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (
      String(row[0]) === String(data.date) &&
      String(row[1]) === String(data.time) &&
      String(row[2]) === String(data.seat)
    ) {
      return jsonResponse({
        success: false,
        error: 'この席はすでに予約済みです。別の席または時間帯をお選びください。'
      });
    }
  }

  // スプレッドシートに保存
  sheet.appendRow([
    data.date,
    data.time,
    data.seat,
    data.seatLabel,
    data.name,
    data.phone,
    data.people,
    data.isHold ? '確保枠' : 'お客様予約',
    JSON.stringify(data.menuOrders || {}),  // メニュー注文 JSON
    new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
  ]);

  // メール通知（確保枠はメール不要の場合はコメントアウト可）
  if (!data.isHold) {
    sendGuestNotification(data);
  } else {
    sendHoldNotification(data);
  }

  return jsonResponse({ success: true });
}

// ============================================================
// メール通知：お客様予約
// ============================================================
function sendGuestNotification(data) {
  const subject = `【あまらんす】新しいご予約 ${data.date} ${data.time}`;

  // メニュー注文をテキスト化
  const MENU_NAMES = {
    m1: '濃厚抹茶のテリーヌ',
    m2: 'しっとりオレンジショコラケーキ',
    m3: 'お砂糖ゼロ低糖質のシフォンケーキ',
    m4: 'お抹茶たらりのアフォガード',
    m5: 'やわらか抹茶あんの苺大福',
    m6: 'パリパリもなか',
    m7: 'てん茶の優しいおにぎりセット（卵焼き、熱々ほうじ茶付き）',
  };
  const orders = data.menuOrders || {};
  const orderLines = Object.entries(orders)
    .filter(([,qty]) => qty > 0)
    .map(([id, qty]) => `　　${MENU_NAMES[id] || id}: ${qty}個`)
    .join('\n');
  const orderText = orderLines || '　　なし';

  const body = `新しいご予約が入りました。

━━━━━━━━━━━━━━━━━
　日付　　: ${data.date}
　時間　　: ${data.time}
　席　　　: ${data.seatLabel}
　お名前　: ${data.name} 様
　電話　　: ${data.phone}
　人数　　: ${data.people} 名
　お菓子注文:
${orderText}
━━━━━━━━━━━━━━━━━

管理者画面でご確認ください。`;

  GmailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}

// ============================================================
// メール通知：スタッフ確保枠
// ============================================================
function sendHoldNotification(data) {
  const subject = `【あまらんす】席確保 ${data.date} ${data.time} ${data.seatLabel}`;
  const body = `スタッフ確保枠を登録しました。

━━━━━━━━━━━━━━━━━
　日付　: ${data.date}
　時間　: ${data.time}
　席　　: ${data.seatLabel}
　確保名: ${data.name}
　人数　: ${data.people} 名
━━━━━━━━━━━━━━━━━`;

  GmailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}

// ============================================================
// 日付・時間フォーマット（スプレッドシートのDate型→文字列）
// ============================================================
function formatDateStr(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatTimeStr(val) {
  if (!val) return '';
  // すでに "9:30" 形式の文字列ならそのまま返す
  if (typeof val === 'string' && /^\d+:\d+/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

// ============================================================
// ユーティリティ
// ============================================================
function getSheet() {
  // ScriptPropertyからスプレッドシートIDを取得（なければ新規作成）
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('SPREADSHEET_ID');
  let ss;
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch(e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('あまらんす予約データ');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  let sheet = ss.getSheetByName(SHEET_NAME);

  // シートがなければ作成してヘッダーを追加
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['日付', '時間', '席ID', '席名', 'お名前', '電話番号', '人数', '種別', 'メニュー注文', '登録日時']);
    sheet.setFrozenRows(1);
    // ヘッダー行のスタイル
    const headerRange = sheet.getRange(1, 1, 1, 10);
    headerRange.setBackground('#1a1a1a');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
  }

  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
