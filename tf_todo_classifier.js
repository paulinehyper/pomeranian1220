// tf_todo_classifier.js
// TensorFlow.js 기반 이메일 본문 -> todo 분류기 (간단한 예시)
const tf = require('@tensorflow/tfjs');

// 예시: 훈련 데이터 (실제 서비스에서는 DB/파일에서 불러오거나, 더 많은 샘플 필요)
// 각 샘플: { text: '메일 본문', label: 1(할일) or 0(아님) }
const trainSamples = [
  { text: '12월 30일까지 보고서를 제출해 주세요', label: 1 },
  { text: '회의 일정 안내', label: 0 },
  { text: '12/31까지 결과를 회신 바랍니다', label: 1 },
  { text: '광고성 메일입니다', label: 0 },
  { text: '1월 5일까지 자료를 보내주세요', label: 1 },
  { text: '점심 식사 안내', label: 0 }
];

// 텍스트를 숫자 벡터로 변환 (아주 단순: 단어 사전 기반 Bag-of-Words)
const vocab = Array.from(new Set(trainSamples.flatMap(s => s.text.split(/\s+/))));
function textToVec(text) {
  const words = text.split(/\s+/);
  return vocab.map(v => words.includes(v) ? 1 : 0);
}

// 훈련 데이터 준비
const xs = tf.tensor2d(trainSamples.map(s => textToVec(s.text)));
const ys = tf.tensor2d(trainSamples.map(s => [s.label]));

// 간단한 모델 정의 (Dense NN)
const model = tf.sequential();
model.add(tf.layers.dense({ units: 8, activation: 'relu', inputShape: [vocab.length] }));
model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
model.compile({ optimizer: 'adam', loss: 'binaryCrossentropy', metrics: ['accuracy'] });

// 훈련 함수
async function train() {
  await model.fit(xs, ys, { epochs: 50, verbose: 0 });
  console.log('모델 훈련 완료');
}

// 예측 함수: 본문을 받아서 0(아님)/1(할일) 반환
async function predictTodo(text) {
  const input = tf.tensor2d([textToVec(text)]);
  const pred = model.predict(input);
  const v = (await pred.data())[0];
  return v > 0.5 ? 1 : 0;
}

module.exports = { train, predictTodo, vocab };
