/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

const tf = require('@tensorflow/tfjs-node');

/* eslint-disable no-console */
// Get the set of unique characters from text
const getCharSet = (text, textLength) => {
  const charSet = [];
  for (let i = 0; i < textLength; ++i) {
    if (charSet.indexOf(text[i]) === -1) {
      charSet.push(text[i]);
    }
  }
  return charSet;
};

// Convert text string to integer indices
const textToIndices = (text, charSet) => {
  const indices = [];
  for (let i = 0; i < text.length; ++i) {
    indices.push(charSet.indexOf(text[i]));
  }
  return indices;
};

// Get a random slice of text data
const getRandomSlice = (text, textLength, sampleLength, charSet) => {
  const startIndex = Math.round(Math.random() * (textLength - sampleLength - 1));
  const textSlice = text.slice(startIndex, startIndex + sampleLength);
  return [textSlice, textToIndices(textSlice, charSet)];
};

// Creates LSTM model
const createModel = (sampleLen, charSetSize, lstmLayerSizes) => {
  const model = tf.sequential();

  for (let i = 0; i < lstmLayerSizes.length; ++i) {
    const lstmLayerSize = lstmLayerSizes[i];
    model.add(
      tf.layers.lstm({
        units: lstmLayerSize,
        returnSequences: i < lstmLayerSizes.length - 1,
        inputShape: i === 0 ? [sampleLen, charSetSize] : undefined,
      }),
    );
  }
  model.add(tf.layers.dense({ units: charSetSize, activation: 'softmax' }));

  return model;
};

// Compiles model
const compileModel = (model, learningRate) => {
  const optimizer = tf.train.rmsprop(learningRate);
  model.compile({ optimizer, loss: 'categoricalCrossentropy' });
  console.log(`Compiled model with learning rate ${learningRate}`);
  model.summary();
};

// Trains model
const fitModel = async (
  model,
  textLength,
  sampleLength,
  sampleStep,
  charSetSize,
  indices,
  numEpochs,
  examplesPerEpoch,
  batchSize,
  validationSplit,
  callbacks,
) => {
  for (let index = 0; index < numEpochs; ++index) {
    // Prepare beginning indices of examples.
    const exampleBeginIndices = [];
    for (let j = 0; j < textLength - sampleLength - 1; j += sampleStep) {
      exampleBeginIndices.push(j);
    }

    // Randomly shuffle the beginning indices.
    tf.util.shuffle(exampleBeginIndices);
    let examplePosition = 0;

    const xsBuffer = new tf.TensorBuffer([examplesPerEpoch, sampleLength, charSetSize]);
    const ysBuffer = new tf.TensorBuffer([examplesPerEpoch, charSetSize]);
    for (let i = 0; i < examplesPerEpoch; ++i) {
      const beginIndex = exampleBeginIndices[examplePosition % exampleBeginIndices.length];
      for (let j = 0; j < sampleLength; ++j) {
        xsBuffer.set(1, i, j, indices[beginIndex + j]);
      }
      ysBuffer.set(1, i, indices[beginIndex + sampleLength]);
      examplePosition++;
    }

    const xs = xsBuffer.toTensor();
    const ys = ysBuffer.toTensor();

    await model.fit(xs, ys, {
      epochs: 1,
      batchSize,
      validationSplit,
      callbacks,
    });
    xs.dispose();
    ys.dispose();
  }
};

// Draw a sample based on probabilities.
// eslint-disable-next-line arrow-body-style
const sample = (probs, temperature) => {
  return tf.tidy(() => {
    const logits = tf.div(tf.log(probs), Math.max(temperature, 1e-6));
    const isNormalized = false;
    // `logits` is for a multinomial distribution, scaled by the temperature.
    // We randomly draw a sample from the distribution.
    return tf.multinomial(logits, 1, null, isNormalized).dataSync()[0];
  });
};

// Generate text using a next-char-prediction model.
const generateText = async (model, charSet, sentenceIndices, length, temperature, onTextGenerationChar) => {
  const sampleLen = model.inputs[0].shape[1];
  const charSetSize = model.inputs[0].shape[2];

  // Avoid overwriting the original input.
  // eslint-disable-next-line no-param-reassign
  sentenceIndices = sentenceIndices.slice();

  let generated = '';
  while (generated.length < length) {
    // Encode the current input sequence as a one-hot Tensor.
    const inputBuffer = new tf.TensorBuffer([1, sampleLen, charSetSize]);

    // Make the one-hot encoding of the seeding sentence.
    for (let i = 0; i < sampleLen; ++i) {
      inputBuffer.set(1, 0, i, sentenceIndices[i]);
    }
    const input = inputBuffer.toTensor();

    // Call model.predict() to get the probability values of the next
    // character.
    const output = model.predict(input);

    // Sample randomly based on the probability values.
    const winnerIndex = sample(tf.squeeze(output), temperature);
    const winnerChar = charSet[winnerIndex];
    if (onTextGenerationChar != null) {
      await onTextGenerationChar(winnerChar);
    }

    generated += winnerChar;
    // eslint-disable-next-line no-param-reassign
    sentenceIndices = sentenceIndices.slice(1);
    sentenceIndices.push(winnerIndex);

    // Memory cleanups.
    input.dispose();
    output.dispose();
  }
  return generated;
};

module.exports = {
  getCharSet,
  textToIndices,
  getRandomSlice,
  createModel,
  compileModel,
  fitModel,
  sample,
  generateText,
};
