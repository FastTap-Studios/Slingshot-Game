/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import GeminiSlingshot from './components/GeminiSlingshot';

const App: React.FC = () => {
  return (
    <div className="w-full h-full min-h-0 flex flex-col overflow-hidden">
      <GeminiSlingshot />
    </div>
  );
};

export default App;
