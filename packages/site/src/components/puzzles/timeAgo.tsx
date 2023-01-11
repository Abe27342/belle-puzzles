import React from 'react';
import ReactTimeAgo from 'react-time-ago';
import JSTimeAgo from 'javascript-time-ago';

import en from 'javascript-time-ago/locale/en.json';

JSTimeAgo.addDefaultLocale(en);

const TimeAgo: React.FC<{ date: number | Date }> = ({ date }) => (
	<ReactTimeAgo date={date} locale="en-US" />
);
export default TimeAgo;
