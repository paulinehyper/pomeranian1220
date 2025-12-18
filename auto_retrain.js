// 사용자가 todo로 분류한 데이터가 30개 이상이면 자동으로 파인튜닝 스크립트 실행
const { exec } = require('child_process');
const exportTodoTrainData = require('./export_todo_train_data');
const db = require('./db');

function maybeRetrainModel() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM emails WHERE todo_flag IS NOT NULL').get().cnt;
  if (count >= 30) { // 30개 이상이면 파인튜닝
    exportTodoTrainData();
    exec('python train_and_export_onnx.py', (err, stdout, stderr) => {
      if (err) {
        console.error('파인튜닝 실패:', err, stderr);
      } else {
        console.log('파인튜닝 완료:', stdout);
        // onnx 파일을 앱에서 자동으로 사용하도록 경로 지정
      }
    });
  }
}

module.exports = maybeRetrainModel;
