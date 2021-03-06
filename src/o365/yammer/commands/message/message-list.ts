import commands from '../../commands';
import GlobalOptions from '../../../../GlobalOptions';
import {
  CommandOption, CommandValidate
} from '../../../../Command';
import YammerCommand from "../../../base/YammerCommand";
import request from '../../../../request';

const vorpal: Vorpal = require('../../../../vorpal-init');

interface CommandArgs {
  options: Options;
}

interface Options extends GlobalOptions {
  olderThanId?: number;
  threaded?: boolean;
  limit?: number;
  feedType?: string;
  groupId?: number;
  threadId?: number;
}

class YammerMessageListCommand extends YammerCommand {
  private items: any[];
  private static readonly feedTypes: string[] = ['All', 'Top', 'My', 'Following', 'Sent', 'Private', 'Received'];

  constructor() {
    super();
    this.items = [];
  }

  public get name(): string {
    return `${commands.YAMMER_MESSAGE_LIST}`;
  }

  public get description(): string {
    return 'Returns all accessible messages from the user\'s Yammer network';
  }

  public getTelemetryProperties(args: CommandArgs): any {
    const telemetryProps: any = super.getTelemetryProperties(args);
    telemetryProps.olderThanId = args.options.olderThanId !== undefined;
    telemetryProps.threaded = args.options.threaded;
    telemetryProps.limit = args.options.limit !== undefined;
    telemetryProps.feedType = args.options.feedType !== undefined;
    telemetryProps.threadId = args.options.threadId !== undefined;
    telemetryProps.groupId = args.options.groupId !== undefined;
    return telemetryProps;
  }

  private getAllItems(cmd: CommandInstance, args: CommandArgs, messageId: number): Promise<void> {
    return new Promise<void>((resolve: () => void, reject: (error: any) => void): void => {
      let endpoint = `${this.resource}/v1`;

      if (args.options.threadId) {
        endpoint += `/messages/in_thread/${args.options.threadId}.json`
      }
      else if (args.options.groupId) {
        endpoint += `/messages/in_group/${args.options.groupId}.json`
      }
      else {
        if (!args.options.feedType) {
          args.options.feedType = "All";
        }

        switch (args.options.feedType) {
          case 'Top':
            endpoint += `/messages/algo.json`;
            break;
          case 'My':
            endpoint += `/messages/my_feed.json`;
            break;
          case 'Following':
            endpoint += `/messages/following.json`;
            break;
          case 'Sent':
            endpoint += `/messages/sent.json`;
            break;
          case 'Private':
            endpoint += `/messages/private.json`;
            break;
          case 'Received':
            endpoint += `/messages/received.json`;
            break;
          default:
            endpoint += `/messages.json`;
        }
      }

      if (messageId !== -1) {
        endpoint += `?older_than=${messageId}`;
      }
      else if (args.options.olderThanId) {
        endpoint += `?older_than=${args.options.olderThanId}`;
      }

      if (args.options.threaded) {
        if (endpoint.indexOf("?") > -1) {
          endpoint += "&";
        }
        else {
          endpoint += "?";
        }

        endpoint += `threaded=true`;
      }

      const requestOptions: any = {
        url: endpoint,
        headers: {
          accept: 'application/json;odata.metadata=none',
          'content-type': 'application/json;odata=nometadata'
        },
        json: true
      };

      request
        .get(requestOptions)
        .then((res: any): void => {
          this.items = this.items.concat(res.messages);

          if (args.options.limit && this.items.length > args.options.limit) {
            this.items = this.items.slice(0, args.options.limit);
            resolve();
          }
          else {
            if (res.meta.older_available === true) {
              this
                .getAllItems(cmd, args, this.items[this.items.length - 1].id)
                .then((): void => {
                  resolve();
                }, (err: any): void => {
                  reject(err);
                });
            }
            else {
              resolve();
            }
          }
        }, (err: any): void => {
          reject(err);
        });
    });
  };

  public commandAction(cmd: CommandInstance, args: CommandArgs, cb: () => void): void {
    this.items = []; // this will reset the items array in interactive mode

    this
      .getAllItems(cmd, args, -1)
      .then((): void => {
        if (args.options.output === 'json') {
          cmd.log(this.items);
        }
        else {
          cmd.log(this.items.map((n: any) => {
            let shortBody;
            const bodyToProcess = n.body.plain;

            if (bodyToProcess) {
              let maxLength = 35;
              let addedDots = "...";
              if (bodyToProcess.length < maxLength) {
                maxLength = bodyToProcess.length;
                addedDots = "";
              }

              shortBody = bodyToProcess.replace(/\n/g, ' ').substring(0, maxLength) + addedDots;
            }

            const item: any = {
              id: n.id,
              replied_to_id: n.replied_to_id,
              thread_id: n.thread_id,
              group_id: n.group_id,
              shortBody: shortBody
            };
            return item;
          }));
        }

        cb();
      }, (err: any): void => this.handleRejectedODataJsonPromise(err, cmd, cb));
  };

  public options(): CommandOption[] {
    const options: CommandOption[] = [
      {
        option: '--olderThanId [olderThanId]',
        description: 'Returns messages older than the message ID specified as a numeric string'
      },
      {
        option: '-f, --feedType [feedType]',
        description: 'Returns messages from a specific feed. Available options: All|Top|My|Following|Sent|Private|Received. Default All',
        autocomplete: YammerMessageListCommand.feedTypes
      },
      {
        option: '--groupId [groupId]',
        description: 'Returns the messages from a specific group'
      },
      {
        option: '--threadId [threadId]',
        description: 'Returns the messages from a specific thread'
      },
      {
        option: '--threaded',
        description: 'Will only return the thread starter (first message) for each thread. This parameter is intended for apps which need to display message threads collapsed'
      },
      {
        option: '--limit [limit]',
        description: 'Limits the messages returned'
      }
    ];

    const parentOptions: CommandOption[] = super.options();
    return options.concat(parentOptions);
  }

  public validate(): CommandValidate {
    return (args: CommandArgs): boolean | string => {
      if (args.options.groupId && args.options.threadId) {
        return `You cannot specify groupId and threadId at the same time`;
      }

      if (args.options.feedType && (args.options.groupId || args.options.threadId)) {
        return `You cannot specify the feedType with groupId or threadId at the same time`;
      }

      if (args.options.feedType && YammerMessageListCommand.feedTypes.indexOf(args.options.feedType) < 0) {
        return `${args.options.feedType} is not a valid value for the feedType option. Allowed values are ${YammerMessageListCommand.feedTypes.join('|')}`;
      }

      if (args.options.olderThanId && typeof args.options.olderThanId !== 'number') {
        return `${args.options.olderThanId} is not a number`;
      }

      if (args.options.groupId && typeof args.options.groupId !== 'number') {
        return `${args.options.groupId} is not a number`;
      }

      if (args.options.threadId && typeof args.options.threadId !== 'number') {
        return `${args.options.threadId} is not a number`;
      }

      if (args.options.limit && typeof args.options.limit !== 'number') {
        return `${args.options.limit} is not a number`;
      }

      return true;
    };
  }

  public commandHelp(args: {}, log: (help: string) => void): void {
    const chalk = vorpal.chalk;
    log(vorpal.find(this.name).helpInformation());
    log(
      `  Remarks:
  
    ${chalk.yellow('Attention:')} In order to use this command, you need to grant the Azure AD
    application used by the Office 365 CLI the permission to the Yammer API.
    To do this, execute the ${chalk.blue('consent --service yammer')} command.

    Feed types:
  
      - All: Corresponds to “All” conversations in the Yammer web interface
      - Top: The algorithmic feed for the user that corresponds to "Top"
        conversations. The Top conversations feed is the feed currently shown in
        the Yammer mobile apps
      - My: The user’s feed, based on the selection they have made between
        "Following" and "Top" conversations
      - Following: The "Following" feed which is conversations involving people
        and topics that the user is following
      - Sent: All messages sent by the user
      - Private: Private messages received by the user
      - Received: All messages received by the user
    
  Examples:
    
    Returns all Yammer network messages
      ${this.name}
    
    Returns all Yammer network messages older than the message ID 5611239081
      ${this.name} --olderThanId 5611239081

    Returns all Yammer network thread starter (first message) for each thread
      ${this.name} --threaded

    Returns the first 10 Yammer network messages
      ${this.name} --limit 10

    Returns the first 10 Yammer network messages from the Yammer group 312891231
      ${this.name} --groupId 312891231 --limit 10

    Returns the first 10 Yammer network messages from thread 5611239081
      ${this.name} --threadId 5611239081 --limit 10
    
    Returns the first 20 Yammer message from the sent feed of the user
      ${this.name} --feedType Sent --limit 20
`);
  }
}

module.exports = new YammerMessageListCommand();