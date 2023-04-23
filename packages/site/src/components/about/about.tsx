import * as React from 'react';
import './about.css';
import { Card } from '../../fast';
import { NavLink } from 'react-router-dom';
import googleDriveExampleUrl from './assets/google-drive-example.png';
import addRoundExampleUrl from './assets/add-round-example.png';
import addPuzzleExampleUrl from './assets/add-puzzle-example.png';
import roundEmbedsExampleUrl from './assets/round-embeds-example.png';
import solveUrl from './assets/solve-example.png';
import updateStatusExampleUrl from './assets/update-status-example.png';

export const About: React.FC = () => {
	return (
		<div className="page-body" id="about">
			<Card>
				<h1>About</h1>
				<p>
					This bot is a resource developed by the Libra Complexity
					team for solving puzzlehunts like{' '}
					<a href="https://puzzles.mit.edu/">mystery hunt</a> or{' '}
					<a href="https://aka.ms/puzzlehunt">Microsoft Puzzlehunt</a>{' '}
					in a team setting. One of the main challenges of this
					setting is determining how to effectively collaborate. Belle
					provides a Discord framework for puzzlehunt tracking,
					communicating, and solving. The puzzlehunt is tracked in a
					tree of <em>rounds</em> and <em>puzzles</em>. This tree
					structure is reflected in the discord server for the
					puzzlehunt, which contains a category for each round and
					places the puzzle channels in that category. To reduce
					visual clutter, solvers can easily hide and view rounds or
					puzzles using{' '}
					<a href="https://discordjs.guide/popular-topics/embeds.html">
						embeds
					</a>{' '}
					on the round index channels. Belle creates a google sheet
					for each puzzle, which is linked from the puzzle page.
				</p>
				<h2>Commands</h2>
				<p>
					The main flow for interacting with Belle is through{' '}
					<a href="https://discord.com/blog/slash-commands-are-here">
						slash commands
					</a>
					. Discord provides convenient autocomplete with a short
					description of each command, but some nuances are expounded
					upon below.
				</p>
				<h3>Create</h3>
				<p>
					Initializes a puzzlehunt in the server. This will create an
					admin channel which contains information about the backing
					Fluid file and some other generic top-level information. The
					channel is only visible to server administrators by default.
					This command must be run before any other commands.
				</p>
				<p>
					Puzzlehunt initialization requires a publicly shared Google
					Drive folder for Belle to create new puzzle sheets in. After
					creating a folder for puzzles, you should copy the link via
					Google Drive's share UI.
				</p>
				<img src={googleDriveExampleUrl} />
				<h3>Add Round</h3>
				<p>
					Adds a round to the puzzlehunt. If the{' '}
					<code>parent_round</code> argument is not provided, the
					created round defaults to being a child of the nearest
					ancestor round relative to the channel the command is run
					in. If no such channel exists (e.g. the{' '}
					<code>add_round</code> command was created from "general"),
					the round will be created as a root round.
				</p>
				<p className="remark">
					The parent round can be provided conveniently using
					discord's autocomplete UI for channels: type "#" and find
					the channel.
				</p>
				<img src={addRoundExampleUrl} />
				<h3>Add Puzzle</h3>
				<p>
					Adds a puzzle to the puzzlehunt. Puzzles{' '}
					<em>must be parented</em>. Like <code>add_round</code>, if
					the <code>parent_round</code> argument isn't provided, the
					puzzle defaults to being a child of the nearest ancestor
					round relative to the channel the command is run in.
				</p>
				<img src={addPuzzleExampleUrl} />
				<h3>Update Status</h3>
				<p>
					Updates the current status of solving a puzzle. This causes
					a message to be sent to "status updates" log and causes the
					puzzle to be displayed closer to the top of the "most
					recently updated" view in the puzzlehunt viewer.
				</p>
				<img src={updateStatusExampleUrl} />
				<h3>Solve</h3>
				<p>Solves a puzzle with the provided answer.</p>
				<img src={solveUrl} />
				<h3>Unsolve</h3>
				<p>Can be used to undo an erroneous solve.</p>
				<h3>Sync All</h3>
				<p>
					This command re-syncs the discord server to reflect the
					state of the backing Fluid file. It can be useful to recover
					from failures.
				</p>
				<h2>Additional Features</h2>
				<p>
					In addition to supporting slash commands, Belle listens to a
					limited set of interactions affecting puzzlehunt structure
					on servers she's added to.
				</p>
				<h3>Role Interactions</h3>
				<p>
					Belle creates a role for each puzzle and round which
					dictates visibility of the associated channels. Solvers can
					subscribe or unsubscribe to visibility of those channels
					using round embeds that Belle generates.
				</p>
				<img src={roundEmbedsExampleUrl}></img>
				<h3>Channel Movement</h3>
				<p>
					Belle listens to channel update events from discord. In the
					event that a puzzle channel is moved into a different round
					category, Belle updates that puzzle's parentage. This can be
					useful for puzzlehunt structures in which the rounds aren't
					necessarily known in advance, or for re-organization of
					puzzles mid-hunt.
				</p>
				<h2>Fixup</h2>
				<p>
					If things go wrong, there are a couple options you have.
					Running the <code>sync_all</code> command is always a safe
					first step when the discord server gets desynced. To delete
					puzzles or rounds, use the editing UI on the{' '}
					<NavLink to="/servers">Puzzlehunt Viewer</NavLink>. Deleting
					a puzzle object will remove the associated discord channels,
					but it never deletes the associated google sheet. The
					Puzzlehunt viewer can also be used to explicitly set a
					puzzle's google sheet ID. This feature may be useful if
					something goes wrong with a puzzle channel mid-solve.
				</p>
				<h2>Permissions</h2>
				<p>
					Belle doesn't currently support a permissions model: beware
					that created google sheets and all puzzlehunts are available
					to the general public from an information security
					standpoint.
				</p>
				<h2>Technical Details</h2>
				<p>
					Belle is a discord bot written using{' '}
					<a href="https://discord.js.org/">discord.js</a>. It uses
					the <a href="https://fluidframework.com">Fluid Framework</a>{' '}
					with{' '}
					<a href="https://fluidframework.com/docs/deployment/azure-frs/">
						Azure Fluid Relay
					</a>{' '}
					to store documents. This enables viewing the puzzlehunt in
					other environments, such as the{' '}
					<NavLink to="/servers">puzzlehunt viewer</NavLink> on this
					website. All code is available on{' '}
					<NavLink to="https://github.com/Abe27342/belle-puzzles">
						GitHub
					</NavLink>
					. Contributions/requests/issues are welcome, though
					documentation is currently quite sparse.
				</p>
			</Card>
		</div>
	);
};
