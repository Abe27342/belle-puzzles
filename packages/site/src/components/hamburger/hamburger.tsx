import { ChangeEventHandler } from 'react';
import './hamburger.css';

export const HamburgerIcon: React.FC<{
	open: boolean;
	onChange: ChangeEventHandler<HTMLInputElement>;
}> = ({ onChange, open }) => {
	return (
		<label htmlFor="check">
			<input
				type="checkbox"
				id="check"
				checked={open}
				onChange={onChange}
			/>
			<span></span>
			<span></span>
			<span></span>
		</label>
	);
};
